# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Flower WMS — Next.js 16 standalone + Prisma 7 + PostgreSQL
# 构建上下文：monorepo 根目录（42_flower_management/）
# 应用源码：flower-wms-system/
#
# 与 docker-compose.yml 对齐的镜像名：flower-platform-app:latest
#
# 本地构建（仓库根目录）：
#   docker build -t flower-platform-app:latest \
#     --build-arg NEXT_PUBLIC_API_URL=https://www.universe42.studio \
#     --build-arg NEXT_PUBLIC_ASSET_BASE_URL=https://www.universe42.studio \
#     .
#
# flower-web：entrypoint 自动 prisma migrate deploy
# flower-cron-worker：compose 覆盖 entrypoint 为 cron-inventory-daemon.ts
# ---------------------------------------------------------------------------

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl wget
WORKDIR /app

# ---------- 依赖 ----------
FROM base AS deps
COPY flower-wms-system/package.json flower-wms-system/package-lock.json ./
RUN npm ci

# ---------- 生产依赖（prisma / bcryptjs / tsx / dotenv 供 migrate、seed、cron） ----------
FROM deps AS prod-deps
RUN npm prune --omit=dev

# ---------- 构建 ----------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY flower-wms-system/ .

ENV NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate

ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ARG NEXT_PUBLIC_ASSET_BASE_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_ASSET_BASE_URL=$NEXT_PUBLIC_ASSET_BASE_URL

ARG DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
ENV DATABASE_URL=$DATABASE_URL

RUN npm run build

# ---------- 运行 ----------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=prod-deps --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=prod-deps --chown=nextjs:nodejs /app/package-lock.json ./package-lock.json
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated
COPY --from=builder --chown=nextjs:nodejs /app/src/lib ./src/lib
COPY --from=builder --chown=nextjs:nodejs /app/src/services ./src/services
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/login" >/dev/null 2>&1 || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
