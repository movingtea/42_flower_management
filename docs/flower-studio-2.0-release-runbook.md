---
title: Flower Studio 2.0 最小发布 Runbook（单机 Docker Compose）
type: runbook
module: platform
status: draft
version: 1
owner: engineering
updated: 2026-11-10
sources:
  - ".github/workflows/deploy.yml"
  - "Dockerfile"
  - "docker-compose.example.yml"
  - "deploy/nginx/README.md"
  - "deploy/rehearsal/README.md"
  - "docs/flower-studio-2.0-local-run.md"
  - ".env.production.example"
  - "knowledge/05-ADR/ADR-001-v1-v2-transition.md"
  - "knowledge/05-ADR/ADR-002-v2-database-migration.md"
  - "knowledge/06-Lessons/E0-known-gaps.md"
related:
  - "[[ADR-001-v1-v2-transition]]"
  - "[[ADR-002-v2-database-migration]]"
  - "[[E0-known-gaps]]"
---

# Flower Studio 2.0 最小发布 Runbook（单机 Docker Compose）

本文是 Flower WMS（`flower-wms-system`）在单台 ECS 上用 Docker Compose 发布 **V1 + V2 并存版本**的最小操作手册，覆盖：

- 发布前检查、联系人与故障记录模板
- 备份与恢复检查
- V1/V2 迁移状态、迁移执行与前后数据核对
- 按提交 SHA 部署 `flower-web` 与 `flower-cron-worker`
- 健康检查与核心冒烟
- 失败停止条件、应用镜像回滚、不可逆迁移处置
- 依据 [ADR-001](../knowledge/05-ADR/ADR-001-v1-v2-transition.md) 的 V1/V2 归属与 V1 退役条件

本手册以 [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)、[Dockerfile](../Dockerfile)、[docker-compose.example.yml](../docker-compose.example.yml) 和 [V2 本地运行文档](flower-studio-2.0-local-run.md) 为事实来源。

> **发布与生产切换只由项目用户批准。** 本手册不授予任何自动发布权限。
> 非生产演练资源与证据见 [deploy/rehearsal/README.md](../deploy/rehearsal/README.md) 与
> `docs/stage-artifacts/evidence/sprint-e1/logs/e18-*.log`（本次演练 `run_id` 见第 13 节）。

---

## 1. 适用范围与前提

| 项目 | 约定 |
|---|---|
| 部署形态 | 单台 Linux ECS + Docker Compose，`docker-compose.yml` 与 `.env` 位于 `/root/flower-platform/` |
| 应用镜像 | 由 GitHub Actions 构建并推送到阿里云 ACR，tag 为提交 SHA 与 `latest` |
| 应用进程 | `flower-web`（Next.js standalone，entrypoint 自动迁移）与 `flower-cron-worker`（`cron-inventory-daemon.ts`） |
| 数据库 | 单 PostgreSQL 容器，V1 库由 `POSTGRES_DB` 创建，V2 库必须**预先创建**且库名与 V1 不同 |
| 边缘 | `flower-nginx`（80/443，配置与证书来自 `/root/flower-nginx/`） |
| 认证 | Auth.js 共用入口，员工账号在 V2 自己的库（`StaffUser`/`TenantMember`/`StoreMember`） |
| 不在本手册范围 | 多实例/滚动发布、蓝绿、Kubernetes、跨地域容灾、小程序和 CMS 独立部署 |

**发布前必须确认**：本次发布是否只更新应用镜像，是否包含新的数据库迁移。含迁移的发布按第 5 节执行；只更新镜像也仍需第 4 节备份（除非项目用户书面豁免）。

---

## 2. 联系人、审批与故障记录模板

### 2.1 联系人（发布前由项目维护者填写并确认）

| 角色 | 姓名 | 电话/即时通讯 | 备份联系人 | 职责 |
|---|---|---|---|---|
| 发布负责人 | 待填写 | 待填写 | 待填写 | 执行本手册、决定停止/回滚（经审批） |
| 发布审批人（项目用户） | 待填写 | 待填写 | — | 批准发布窗口、回滚与数据处置 |
| 后端/应用值班 | 待填写 | 待填写 | 待填写 | 处理迁移、健康检查、日志定位 |
| 数据库/运维 | 待填写 | 待填写 | 待填写 | 备份、恢复、磁盘与容器资源 |
| 业务验收 | 待填写 | 待填写 | — | 发布后业务冒烟与放行 |
| 云资源/ACR 权限人 | 待填写 | 待填写 | 待填写 | 镜像推送、ECS 登录与网络问题 |

> 未完成联系人确认不得开始生产发布。

### 2.2 发布审批记录（发布窗口前填写）

| 字段 | 内容 |
|---|---|
| 发布窗口 | 待填写（建议低峰、无进行中的大促/配送高峰） |
| 目标提交 SHA | 待填写（Git `dev`/发布分支 HEAD） |
| 镜像 digest | 待填写（`docker image inspect ... --format '{{index .RepoDigests 0}}'`） |
| 数据库迁移 | 待填写（无 / V1 x 个 / V2 y 个；见第 5 节） |
| 备份文件与位置 | 待填写（见第 4 节） |
| 批准人/时间 | 待填写 |
| 回滚镜像 SHA | 待填写（上一版生产镜像 SHA） |

### 2.3 故障记录模板（发布期间出现任何异常即开始记录）

```text
故障编号：REL-YYYYMMDD-NN
发现时间：YYYY-MM-DD HH:MM:SS (+08:00)
发现人 / 发现方式：<姓名 / 健康检查 / 冒烟 / 用户反馈>
当前发布阶段：<预检 / 备份 / 迁移 / 重启 / 健康 / 冒烟 / 清理>
目标 SHA：<sha；镜像 digest>
上一版 SHA：<sha>
影响范围：<全部不可用 / 部分功能 / 仅内部页面 / 无用户影响>
现象与证据：<命令、退出码、日志关键词、截图、健康返回体>
已执行操作：<按时间线列出，含每步退出码>
临时处置：<继续观察 / 停止发布 / 回滚应用镜像 / 恢复数据库（需审批）>
是否触发停止条件：<是/否；对应第 9 节编号>
根因（初判 / 最终）：
后续动作与负责人：
审批人确认：<姓名 / 时间>
```

---

## 3. 发布前检查（开始发布前逐项打勾）

在 ECS 的 `/root/flower-platform/` 执行。所有命令不得修改数据库。

### 3.1 变更与审批

- [ ] 发布审批记录（2.2）已由项目用户确认。
- [ ] 目标 SHA 已合入发布分支，工作区干净；本手册与 Runbook 版本一致。
- [ ] 明确本次是否包含数据库迁移；含迁移时已完成第 4 节备份。
- [ ] 已确认上一版生产镜像 SHA 可拉取（回滚用）。

### 3.2 主机、磁盘与 Docker 资源

```bash
cd /root/flower-platform
df -h /
docker system df
docker version --format '{{.Server.Version}}'
docker compose version
```

- [ ] 根分区可用空间 ≥ 10 GiB（低于则先清理/扩容，禁止带病发布）。
- [ ] Docker 磁盘未接近上限；无僵尸容器。
- [ ] 记录当前运行版本：

```bash
docker compose ps
docker inspect flower-web-prod --format 'image={{.Image}} started={{.State.StartedAt}}'
docker inspect flower-cron-worker-prod --format 'image={{.Image}} started={{.State.StartedAt}}'
```

### 3.3 镜像与提交 SHA 对照

```bash
IMAGE="crpi-bp5b6vut8l4d7ebv.cn-hangzhou.personal.cr.aliyuncs.com/universe42/flower-platform-app"
TARGET_SHA="<目标提交 SHA>"
docker manifest inspect "${IMAGE}:${TARGET_SHA}" >/dev/null   # 需 ACR 已登录
docker pull "${IMAGE}:${TARGET_SHA}"
docker image inspect "${IMAGE}:${TARGET_SHA}" \
  --format 'id={{.Id}} arch={{.Os}}/{{.Architecture}} digest={{index .RepoDigests 0}}'
```

- [ ] ACR 已登录（`docker login`），目标 SHA 镜像存在且为 `linux/amd64`。
- [ ] 记录镜像 `Id` 与 `RepoDigests` 到发布审批记录；**以 digest 作为回滚/审计依据**。
- [ ] 若 workflow 失败或镜像缺失：停止发布，不得手工用 `latest` 顶替。

### 3.4 环境变量核对（只核对，不打印密钥）

```bash
cd /root/flower-platform
ls -l .env                      # 权限应为 600，属主为部署用户
grep -E '^(DATABASE_URL|V2_DATABASE_URL|NEXTAUTH_URL|AUTH_SECRET|NEXTAUTH_SECRET)=' .env | sed 's/=.*/=<redacted>/'
docker compose config >/dev/null && echo 'compose config OK'
```

- [ ] `.env` 含独立的 `DATABASE_URL`（V1）与 `V2_DATABASE_URL`（V2），库名不同。
- [ ] `AUTH_SECRET`/`NEXTAUTH_SECRET` 已设置且非示例值，权限 600。
- [ ] 本次发布所需外部服务变量（OSS、DeepSeek、微信等）与线上一致；**不得把真实密钥写入仓库或本 Runbook**。
- [ ] `docker compose config` 通过（语法/变量插值无误）。

### 3.5 V1/V2 数据库目标与迁移状态

```bash
# 目标校验（与 deploy.yml 一致；--connect 会真实连接）
docker compose run --rm --no-deps --entrypoint sh flower-web -ec '
  : "${DATABASE_URL:?DATABASE_URL is required}"
  : "${V2_DATABASE_URL:?V2_DATABASE_URL is required}"
  node scripts/check-v2-database-target.mjs --connect
'
# 迁移状态（V1）
docker compose exec -T flower-web npx prisma migrate status
# 迁移状态（V2）
docker compose exec -T flower-web npm run db:v2:migrate:status
```

- [ ] `--connect` 成功；**V2 数据库必须已存在**（entrypoint 的 `migrate deploy` 在目标库不存在时可能自动创建数据库，不能替代人工预建）。
- [ ] 记录 V1/V2 当前已应用迁移数、待应用迁移；V2 待应用迁移应等于本次发布包含的新迁移。
- [ ] 若 V2 状态与发布内容不一致（数据库超前/落后异常）：停止，先排查（见第 5.3 节）。

### 3.6 发布前备份（含迁移时必须）

见第 4 节。**备份未校验通过不得继续。**

### 3.7 Nginx 配置校验（涉及域名的发布）

```bash
docker compose exec -T flower-nginx nginx -t
docker compose exec -T flower-nginx nginx -T | grep -E 'client_max_body_size|server_name' | head
```

- [ ] `nginx -t` 通过；`client_max_body_size` ≥ 5m（大于应用 `UPLOAD_MAX_SIZE_MB`，见 [deploy/nginx/README.md](../deploy/nginx/README.md)）。

---

## 4. 备份与恢复检查

依据 [ADR-002](../knowledge/05-ADR/ADR-002-v2-database-migration.md)：V2 生产库有正式数据时，变更前必须保留可恢复备份。V1 无正式用户与需保留业务数据，但为审计与误操作兜底仍建议备份。

### 4.1 备份（发布前、迁移前）

```bash
cd /root/flower-platform
TS=$(date -u +%Y%m%dT%H%M%SZ)
BK="/root/flower-backups/${TS}"
mkdir -p "${BK}"

# 以容器内数据库用户执行，输出重定向到宿主机文件（二进制，勿用文本编辑器处理）
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc -d "$POSTGRES_DB"' > "${BK}/v1-${TS}.dump"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc -d flower_v2_prod' > "${BK}/v2-${TS}.dump"

ls -l "${BK}"
sha256sum "${BK}"/*.dump | tee "${BK}/SHA256SUMS"
```

- [ ] V1/V2 两个 dump 非空，`sha256sum` 已记录。
- [ ] 备份文件不在容器卷内；建议同步到对象存储/另一台机器（**异地保留策略与保留期限待维护者确认**）。
- [ ] 记录备份路径、大小、sha256 到发布审批记录。

### 4.2 备份可恢复性校验（每次发布至少做一次）

```bash
# 归档结构可读
docker compose exec -T db sh -c 'pg_restore --list /dev/stdin' < "${BK}/v2-${TS}.dump" | head

# 恢复到临时库（不要 --clean 到生产库），比对行数后删除临时库
docker compose exec -T db sh -ec '
  dropdb --if-exists -U "$POSTGRES_USER" flower_v2_restore
  createdb -U "$POSTGRES_USER" flower_v2_restore
  pg_restore -U "$POSTGRES_USER" -d flower_v2_restore --no-owner --no-privileges /dev/stdin
' < "${BK}/v2-${TS}.dump"

docker compose exec -T db psql -U flower_admin -d flower_v2_prod -c '
  SELECT (SELECT count(*) FROM "Tenant") AS tenant,
         (SELECT count(*) FROM "StaffUser") AS staff,
         (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL) AS migrations;'
docker compose exec -T db psql -U flower_admin -d flower_v2_restore -c '
  SELECT (SELECT count(*) FROM "Tenant") AS tenant,
         (SELECT count(*) FROM "StaffUser") AS staff,
         (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL) AS migrations;'

# 确认一致后删除临时库
docker compose exec -T db dropdb -U flower_admin --if-exists flower_v2_restore
```

- [ ] 恢复库行数和迁移历史与源库一致（或差异已解释）。
- [ ] 临时库已删除，未对生产库执行 `pg_restore --clean`。

### 4.3 恢复检查的边界

- 已演练：`pg_dump -Fc` → `pg_restore` 到隔离库 → 关键表行数/迁移历史一致（见第 13 节证据）。
- 未演练/待决：生产对象存储（OSS 图片）、备份异地保留、RPO/RTO、恢复期间业务停写、恢复责任人。上述在 [ADR-002](../knowledge/05-ADR/ADR-002-v2-database-migration.md) 中仍为待定项，正式恢复须经项目用户批准并在隔离环境预演。

---

## 5. V1/V2 数据库、迁移执行与前后数据核对

### 5.1 V1/V2 归属（ADR-001 / ADR-002）

- 应用根路径跳转 `/v2`；V1 仅保留显式入口，V1/V2 共用 Auth.js 入口，会话标记来源。
- V2 使用**独立数据库**与独立迁移历史（`V2_DATABASE_URL`，`prisma.v2.config.ts`）；V1 继续使用 `DATABASE_URL`。
- **V2 是唯一生产写入端，不做双写/双向同步**。V1 退役条件见第 11 节。
- 生产迁移原则：**只前滚（forward-only），不使用 `migrate reset`/`db push`/手工改迁移历史**。回滚应用镜像不等于回滚数据库。

### 5.2 迁移自动执行机制（当前镜像）

`flower-web` 容器启动时由 [docker-entrypoint.sh](../flower-wms-system/docker-entrypoint.sh) 依次执行：

1. 校验 `DATABASE_URL`/`V2_DATABASE_URL` 存在；
2. `node scripts/check-v2-database-target.mjs`（V1/V2 库名必须不同）；
3. `npx prisma migrate deploy`（V1）；
4. `npm run db:v2:migrate:deploy`（V2，先再次校验目标再 migrate deploy）；
5. `exec node server.js`。

`flower-cron-worker` 在 compose 中覆盖了 entrypoint（直接 `npx tsx scripts/cron-inventory-daemon.ts`），**不执行迁移**；它可能在 web 迁移完成前启动并打印瞬时 P2021/P2022，下一轮自愈。发布后必须确认 cron 出现成功轮次（5.5）。

- 单 web 实例可直接依赖 entrypoint 迁移；多实例前必须改为独立迁移任务并设置 `SKIP_DB_MIGRATE=true`（见 `.env.production.example` 注释）。
- `SKIP_DB_MIGRATE=true` 仅用于「已单独执行迁移」或「回滚旧镜像且 schema 已前进」的场景，使用前必须核对 `migrate status`。

### 5.3 迁移前核对

```bash
# V1：应为本次期望的已应用/待应用状态
docker compose exec -T flower-web npx prisma migrate status

# V2：确认待应用迁移=本次新增迁移；已应用数=发布前基线
docker compose exec -T flower-web npm run db:v2:migrate:status

# V1/V2 迁移历史与行数基线（写入发布记录）
docker compose exec -T db psql -U flower_admin -d flower_hub_prod -c '
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL) AS applied FROM _prisma_migrations;'
docker compose exec -T db psql -U flower_admin -d flower_v2_prod -c '
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL) AS applied FROM _prisma_migrations;'

# V2 关键表行数基线（按实际表名执行；只读）
docker compose exec -T db psql -U flower_admin -d flower_v2_prod -c '
  SELECT
    (SELECT count(*) FROM "Tenant") AS tenant,
    (SELECT count(*) FROM "Store") AS store,
    (SELECT count(*) FROM "StaffUser") AS staff,
    (SELECT count(*) FROM "Material") AS material,
    (SELECT count(*) FROM "ProductSku") AS sku,
    (SELECT count(*) FROM "PurchaseOrder") AS purchase_order,
    (SELECT count(*) FROM "Order") AS orders;'
```

- [ ] V1/V2 库名不同、`--connect` 成功。
- [ ] V2 待应用迁移清单已记录（发布后应全部消失）。
- [ ] 行数基线已记录（迁移后按 5.5 比对）。

### 5.4 迁移执行

迁移由新版本 `flower-web` 启动自动执行（部署步骤见第 6 节）。执行期间：

- 不要同时手工运行 `prisma migrate deploy`（避免并发迁移）。
- 观察入口日志：

```bash
docker compose logs -f --tail=100 flower-web
```

- 迁移失败（容器退出 / 日志 `Error: P1xxx` / `Migration failed`）→ 立即按第 9 节停止，不继续重启或冒烟。

### 5.5 迁移后数据核对

```bash
# 迁移状态：V1/V2 都应为 up to date，待应用为 0
docker compose exec -T flower-web npx prisma migrate status
docker compose exec -T flower-web npm run db:v2:migrate:status

# 迁移历史：V2 已应用数应=发布前基线+本次新增迁移
docker compose exec -T db psql -U flower_admin -d flower_v2_prod -c '
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL) AS applied,
         count(*) FILTER (WHERE finished_at IS NULL) AS unfinished
  FROM _prisma_migrations;'

# 迁移前后行数比对（与 5.3 基线逐项比较；数值应不变，除非发布包含数据修复脚本并已审批）
docker compose exec -T db psql -U flower_admin -d flower_v2_prod -c '
  SELECT
    (SELECT count(*) FROM "Tenant") AS tenant,
    (SELECT count(*) FROM "Store") AS store,
    (SELECT count(*) FROM "StaffUser") AS staff,
    (SELECT count(*) FROM "Material") AS material,
    (SELECT count(*) FROM "ProductSku") AS sku,
    (SELECT count(*) FROM "PurchaseOrder") AS purchase_order,
    (SELECT count(*) FROM "Order") AS orders;'

# 种子基线（首次初始化后应存在；重复执行初始化不得覆盖账号/密码）
docker compose exec -T db psql -U flower_admin -d flower_v2_prod -c '
  SELECT t.slug, s.code FROM "Tenant" t JOIN "Store" s ON s."tenantId" = t.id ORDER BY t.slug, s.code;
  SELECT username, "mustChangePassword" FROM "StaffUser" ORDER BY username;'
```

- [ ] 待应用迁移为 0，未完成迁移为 0。
- [ ] 行数与基线一致（或差异已审批并记录原因）。
- [ ] 默认租户/门店/库存位置存在；生产初始化只在首次执行（`db:v2:init:production`），重复执行保留已有账号、密码和权限。
- [ ] 任一核对不符 → 停止并记录，不得进入冒烟放行。

---

## 6. 按提交 SHA 部署 `flower-web` 与 `flower-cron-worker`

以下命令与 [deploy.yml](../.github/workflows/deploy.yml) 等价；workflow 自动执行时，发布负责人只需监控并核对证据。

### 6.1 生成镜像 override（不修改仓库内生产 compose）

```bash
cd /root/flower-platform
IMAGE="crpi-bp5b6vut8l4d7ebv.cn-hangzhou.personal.cr.aliyuncs.com/universe42/flower-platform-app"
TARGET_SHA="<目标提交 SHA>"
PREV_SHA="<上一版生产 SHA>"                    # 回滚用

override="$(mktemp)"
printf 'services:\n  flower-web:\n    image: "%s"\n  flower-cron-worker:\n    image: "%s"\n' \
  "${IMAGE}:${TARGET_SHA}" "${IMAGE}:${TARGET_SHA}" > "${override}"
compose() { docker compose -f docker-compose.yml -f "${override}" "$@"; }
```

### 6.2 拉取与目标校验（替换前）

```bash
compose pull flower-web flower-cron-worker
compose run --rm --no-deps --entrypoint sh flower-web -ec '
  : "${DATABASE_URL:?DATABASE_URL is required}"
  : "${V2_DATABASE_URL:?V2_DATABASE_URL is required}"
  node scripts/check-v2-database-target.mjs --connect
'
```

- [ ] 拉取成功；`--connect` 成功。任一失败 → 停止，**不重启现有 stack**（现有版本继续运行）。

### 6.3 重启应用（数据库容器不动）

```bash
compose stop flower-nginx flower-web flower-cron-worker || true
compose rm -f flower-nginx flower-web flower-cron-worker || true
compose up -d --no-deps flower-web flower-cron-worker
compose up -d --no-deps flower-nginx
```

- 先 web+cron，后 nginx；`db` 容器不重启、不删除。
- 若 web 启动即失败（迁移/入口错误）→ 立即停止，见第 9 节；不要反复 `up` 覆盖证据。

### 6.4 等待健康并记录

```bash
ok=0
for i in $(seq 1 30); do
  if compose exec -T flower-web wget -T 4 -qO- "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 3
done
if [ "$ok" -ne 1 ]; then
  echo "WARNING: flower-web health probe timed out"
  docker compose logs --tail=100 flower-web
  exit 1
fi
```

- [ ] 90 秒内 `--connect`/健康探测成功；否则停止并回滚（第 10 节）。
- [ ] 记录 `docker compose ps`、web/cron 镜像 digest 与启动时间。

### 6.5 部署后核对

```bash
compose exec -T flower-web npx prisma migrate status
compose exec -T flower-web npm run db:v2:migrate:status
docker exec flower-nginx-edge nginx -s reload || true
docker compose ps
docker compose logs --tail=30 flower-web
docker compose logs --tail=15 flower-cron-worker || true
df -h / ; docker system df
```

- [ ] 迁移状态 up to date（V1/V2）。
- [ ] nginx reload 成功（或确认无配置变更时的可忽略原因）。
- [ ] 清理只使用安全 prune，**不得** `docker system prune -a --volumes`（会删除数据库卷）。

### 6.6 发布后记录

把以下内容写入发布审批记录：目标 SHA、镜像 digest、迁移清单与前后状态、备份路径/sha256、健康与冒烟结果、cron 首轮成功时间、执行人与时间。

---

## 7. 健康检查与核心冒烟

### 7.1 健康检查

`/api/health` 同时查询 V1 与 V2 数据库，任一连不上即返回 503 `{"status":"unavailable"}`。

```bash
# 容器内（与 deploy.yml 一致）
docker compose exec -T flower-web wget -T 4 -qO- "http://127.0.0.1:3000/api/health"
# 经边缘（域名按实际替换）
curl -fsS "https://<生产域名>/api/health"
```

- [ ] 返回 `{"status":"ok"}` 且 HTTP 200。
- [ ] 503/超时 = 失败，按第 9 节停止。

### 7.2 核心冒烟（发布后必须）

| 检查 | 命令/方式 | 期望 |
|---|---|---|
| 登录页可达 | `curl -s -o /dev/null -w '%{http_code}' https://<域名>/login` | 200 |
| 未登录访问工作台 | `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' https://<域名>/v2` | 307 且跳转 `/login?callbackUrl=/v2` |
| 管理员登录 | 浏览器使用 V2 管理员账号登录（生产初始化账号首次登录要求改密） | 登录成功、会话来源 v2 |
| 工作台 | 登录后访问 `/v2` | 200，经营概览卡片渲染 |
| 核心只读页面 | `/v2/inventory`、`/v2/orders`、`/v2/catalog` | 200（无 500/404） |
| cron worker | `docker compose logs --tail=50 flower-cron-worker` | 出现 `[cron-worker] started`，并在 web 迁移完成后出现 `[cron-order-expiry] done` / `[cron-inventory] done`（启动瞬间报 P2021/P2022 可接受，须有成功轮次） |
| 图片上传限制 | 上传 1MB+ 图片 | 不出现裸 413；超限返回 JSON `FILE_TOO_LARGE`（见 nginx README） |

- [ ] 全部通过才能宣布发布完成。
- [ ] 仅健康通过、冒烟失败也需要停止发布并记录，必要时回滚。

---

## 8. 停止条件（出现任一即停止，不得继续下一步）

| 编号 | 条件 | 判定方式 | 立即动作 |
|---|---|---|---|
| S1 | 审批/联系人/回滚镜像未就绪 | 3.1、6.1 检查失败 | 不开始发布 |
| S2 | 磁盘/资源不足 | `df -h /` 可用 < 10 GiB 或 Docker 空间告警 | 不开始；先清理/扩容 |
| S3 | 镜像不存在/架构不符/ACR 拉取失败 | 3.3 失败 | 不发布；查 workflow |
| S4 | env 校验失败（含 V1/V2 同名、缺变量） | 3.4、3.5 失败 | 修正后重跑预检 |
| S5 | 备份失败或不可校验 | 第 4 节未通过 | 不继续 |
| S6 | 迁移执行失败（entrypoint 退出/P1xxx） | 5.4 日志 | 停止；保留日志；应用回滚需审批，数据库优先前滚修复 |
| S7 | 健康检查 90 秒未就绪 | 6.4 | 停止；回滚应用镜像（第 10 节） |
| S8 | 健康接口 503/超时 | 7.1 | 同上 |
| S9 | 核心冒烟失败（登录/工作台/关键页面 5xx、cron 无成功轮次） | 7.2 | 停止；评估回滚 |
| S10 | 迁移前后行数/迁移历史异常 | 5.5 | 停止；禁止冒烟放行；评估恢复（需审批） |
| S11 | nginx 配置/证书错误 | 3.7、6.5 | 不切换流量；修复后重试 |
| S12 | 出现数据损坏/丢失迹象 | 日志、行数、业务反馈 | 立即停止写入与发布，保留现场，通知项目用户 |

停止后必须：保留日志与镜像证据、不回滚数据库、不删除备份、记录故障单（2.3）、由发布负责人决定继续/回滚并取得审批人确认。

---

## 9. `flower-web` 与 `flower-cron-worker` 的回滚

### 9.1 应用镜像回滚（数据库不回滚）

```bash
cd /root/flower-platform
IMAGE="crpi-bp5b6vut8l4d7ebv.cn-hangzhou.personal.cr.aliyuncs.com/universe42/flower-platform-app"
PREV_SHA="<上一版生产 SHA>"

override="$(mktemp)"
printf 'services:\n  flower-web:\n    image: "%s"\n  flower-cron-worker:\n    image: "%s"\n' \
  "${IMAGE}:${PREV_SHA}" "${IMAGE}:${PREV_SHA}" > "${override}"
compose() { docker compose -f docker-compose.yml -f "${override}" "$@"; }

compose pull flower-web flower-cron-worker
compose stop flower-nginx flower-web flower-cron-worker || true
compose rm -f flower-nginx flower-web flower-cron-worker || true
compose up -d --no-deps flower-web flower-cron-worker
compose up -d --no-deps flower-nginx

# 等待健康，然后核对镜像与迁移状态
for i in $(seq 1 30); do
  compose exec -T flower-web wget -T 4 -qO- "http://127.0.0.1:3000/api/health" >/dev/null 2>&1 && break
  sleep 3
done
docker inspect flower-web-prod --format 'image={{.Image}}'
compose exec -T flower-web npm run db:v2:migrate:status
```

- [ ] 健康恢复 200/`status=ok`；镜像 digest 与上一版一致。
- [ ] **不要执行** `prisma migrate reset`、不要删除 `_prisma_migrations` 行、不要手工改 schema。
- [ ] 如果旧镜像无法在已迁移 schema 上启动：优先前滚修复（发布修复版本）或按 9.2 恢复数据库（需审批）。

### 9.2 数据库不可逆迁移处置

- 数据库迁移**不回滚**；已应用迁移记录必须保留。
- 若旧镜像与新 schema 不兼容且无法快速前滚修复，唯一可接受路径：**用发布前备份恢复到新库**，切换 `V2_DATABASE_URL` 到恢复库（或按审批的维护窗口整体恢复），再回滚镜像。恢复前必须：
  1. 停止 web/cron 写入（`compose stop flower-web flower-cron-worker`）；
  2. 保留故障现场与备份（含故障后 dump，用于审计/合并数据）；
  3. 由项目用户书面批准恢复与数据丢失窗口；
  4. 在隔离环境先验证恢复库可被目标镜像启动并通过健康/冒烟；
  5. 记录恢复前后行数与迁移历史。
- 禁止在旧镜像上使用 `migrate resolve --applied` 伪造迁移状态来绕过兼容问题。

### 9.3 回滚镜像兼容前提（发布前必须确认）

| 本次迁移类型 | 旧镜像回滚是否安全 | 说明 |
|---|---|---|
| 仅加列（带默认值/可空）、加表、加索引、加枚举值 | 通常安全（已演练验证） | 旧 Prisma client 不读取新列；插入由数据库默认值兜底 |
| 收紧约束（NOT NULL 无默认、CHECK、唯一索引） | 需验证 | 旧镜像写入可能被新约束拒绝 |
| 删除列/表、重命名、修改列类型、缩减枚举 | **不安全** | 旧镜像读写会失败；必须前滚修复或备份恢复 |
| 数据修复/回填脚本 | 需评估 | 回滚应用不会撤销数据变更 |

发布负责人必须在发布前对照第 10 节不可逆迁移清单，标注本次迁移类型；存在不安全迁移时，**必须准备前滚修复方案与备份恢复预案**，不能只依赖镜像回滚。

---

## 10. 不可逆迁移清单（当前仓库，基于 V2 迁移文件扫描）

Prisma 只提供前滚迁移，**没有 down migration**；以下为按当前 `flower-wms-system/prisma/v2/migrations/` 与 V1 迁移历史的静态核对结果（发布前应再次扫描变更）：

| 迁移 | 操作 | 可逆性 | 回滚旧镜像兼容性 | 处置 |
|---|---|---|---|---|
| V2 `0001_initial` | 创建全部表/枚举/约束（约 74 张表） | 不可逆（只能删除整库或从空库重建） | 不适用（首次发布） | 首次发布前确认 V2 库为空或已备份；禁止 `migrate reset` |
| V2 `0002_sku_estimated_costs` | 加列（NOT NULL DEFAULT 0）+ CHECK | 结构可回退但会丢新数据 | 兼容（旧镜像不读新列） | 数据回退需备份 |
| V2 `0003_purchase_order_timestamps` | 加列 + 索引 | 同上 | 兼容 | 同上 |
| V2 `0004_material_supplier_lifecycle` | 加列 + 索引 | 同上 | 兼容 | 同上 |
| V2 `0005_purchase_order_lifecycle` | 加列 + 索引 | 同上 | 兼容 | 同上 |
| V2 `0006_packaging_kits` | 新建表/索引 | 可丢弃新表但丢数据 | 兼容 | 数据回退需备份 |
| V2 `0007_staff_initial_password` | 加列 `mustChangePassword`（NOT NULL DEFAULT false） | 结构可回退 | 兼容 | — |
| V2 `0008_purchase_supplements_and_inventory_review` | `ALTER TYPE "StocktakeState" ADD VALUE 'PENDING_REVIEW'/'REJECTED'`（**枚举值不可删除**，回退需重建类型）；新建枚举/表/索引/FK/CHECK；`PurchaseOrderLine`/`Stocktake`/`LossRecord` 加列并带默认值 | **部分不可逆**：枚举新增值、CHECK/唯一约束、已写入的复盘/补单数据 | 结构上兼容旧镜像（已演练：加列+加枚举值，旧镜像可启动/健康/冒烟）；数据不可回退 | 若需回退到 0008 之前：优先前滚修复；否则整库恢复备份（枚举回退需重建类型，高风险） |
| V1 历史 45 个迁移 | 包含 DROP COLUMN/DROP TABLE/枚举重命名/类型重建等（如 `product_spu_sku`、`order_checkout_mock_pay`） | 历史迁移不可逆 | 生产 V1 已应用，不在本次回滚范围 | 仅空库初始化时按顺序执行；禁止在已有库上重放/回滚 |

补充说明：

- 迁移 `0008` 是本次工作区相对预构建镜像的新增迁移；**真实发布镜像必须包含当前 HEAD 的全部迁移**（见 12.3 风险）。
- 发布前用只读命令再次确认 V2 迁移状态与待应用清单，并人工复核是否包含上表之外的破坏性语句：

```bash
cd /root/flower-platform
docker compose exec -T flower-web npx prisma migrate status
docker compose run --rm --no-deps --entrypoint sh flower-web -ec '
  grep -RInE "DROP (TABLE|COLUMN|TYPE)|ALTER TYPE .* ADD VALUE|ALTER COLUMN|RENAME " prisma/v2/migrations || true
'
```

- 若本次发布包含「删除/重命名/收紧约束」中的任一操作：升级为**高风险发布**，必须有备份恢复预案、前滚修复版本和项目用户书面批准，不能仅凭镜像回滚。

---

## 11. V1/V2 归属与 V1 退役条件（依据 ADR-001）

依据 [ADR-001](../knowledge/05-ADR/ADR-001-v1-v2-transition.md)（已批准，2026-11-09）：

- 用户确认 V1 没有正式用户、数据库没有需保留的业务数据；**V1 数据备份、导入 V2、跨版本对账、向 V1 回灌均不在退役范围内**。
- V1 退役条件：**V2 完整覆盖 V1 功能并逐项验收通过**。此前保留 V1。
- 退役时停用 V1 页面、API、凭据提供者和仅服务 V1 的后台任务；先核对 V2 是否仍依赖共用服务或后台任务。
- V2 使用自己的员工账号和门店成员权限；两版并存期间按路由验证会话来源；V2 成为唯一生产写入端，无需双写或双向同步。
- 下线验收以 [V1/V2 功能差距矩阵](flower-studio-2.0-v1-v2-gap-matrix.md) 为盘点起点，逐项记录 V2 入口/等效流程、验收证据与结果；P1 WMS 验收是阶段里程碑。
- 只要还有 V1 功能在 V2 缺失、部分覆盖或未通过验收，就保留 V1。**退役决策由项目用户批准**，本 Runbook 不包含退役操作。

本次发布仍为「V1/V2 并存」：V1 页面与后台入口保留，V2 为默认入口；发布不迁移 V1 业务数据。

---

## 12. 已知风险与待决项（发布前逐项确认）

### 12.1 生产 PostgreSQL 卷路径与版本（高）

`docker-compose.example.yml`/`docker-compose.yml` 的 db 卷挂载为 `/var/lib/postgresql/data`，但 `postgres:alpine` 目前解析为 **PostgreSQL 18.6**，其 `PGDATA=/var/lib/postgresql/18/docker`。官方 PG18 镜像建议把卷挂载到 `/var/lib/postgresql`；沿用旧挂载路径时，**重建容器可能丢失数据库数据**。

- 发布前动作（由维护者确认，不在本 Runbook 直接改生产 compose）：
  - 固定数据库镜像版本/digest（例如低版本 PG17 或明确 PG18 且修正卷路径），并先在非生产验证升级/迁移；或
  - 若已运行 PG18：把卷路径改为 `/var/lib/postgresql`，并制定带备份的切换步骤。
- 本项在发布前未确认前，**不得重建数据库容器**。演练栈使用 PG18 正确挂载路径，但生产 compose 未修改。

### 12.2 工作区空迁移目录（中）

当前工作区存在空的 `flower-wms-system/prisma/migrations/0008_purchase_supplements_and_inventory_review/` 目录（未跟踪，无 `migration.sql`）。若被真实构建打入镜像，可能影响 `migrate deploy`。发布前构建镜像时必须确认工作区干净/该空目录已清理，并以 CI 构建产物为准。

### 12.3 本地无法验证真实构建（高）

当前 npm 镜像（npmmirror）的 vitest 包返回 500，本机无 ACR/GitHub 凭据，因此本地演练使用预构建镜像 `flower-e05-verification:final`（仅 7 个 V2 迁移）+ 模拟 SHA 标签：

- 不能证明当前 HEAD 可成功 `docker build`；
- 不能证明镜像已推送 ACR、GitHub workflow 已真实执行、远程 SSH 部署成功；
- 真实发布前必须由维护者在 CI 构建并验证 digest；本 Runbook 不宣称上述项已通过。

### 12.4 entrypoint 目标校验边界（中）

`check-v2-database-target.mjs`（不带 `--connect`）只校验 URL 形状与 V1/V2 库名不同；`prisma migrate deploy` 在目标库不存在时可能**自动创建数据库**。本次工作在本地隔离库做附加试验观察（2026-11-10，未纳入 `e18-*` 证据日志）：把 `V2_DATABASE_URL` 指向同一 PostgreSQL 实例上不存在的库名时，entrypoint 会创建该库并应用迁移，而不是报错。

- 因此预检必须运行 `--connect`（第 3.5 节），并确认 V2 库已由人工预建、库名正确；
- 发布脚本（deploy.yml）已内置 `--connect` 预检，但手工回滚/应急操作也必须执行。

### 12.5 cron worker 启动竞争（低）

`flower-cron-worker` 与 `flower-web` 同时启动，迁移完成前可能报 P2021/P2022；下一轮（60 秒内）自愈。发布后按 7.2 确认成功轮次；若连续多轮失败则按 S9 停止。

### 12.6 备份/恢复与停机参数未定（高，需项目用户决定）

生产 V2 备份周期、异地保留、恢复责任人、可接受停机与数据丢失上限（RPO/RTO）在 ADR-002 中仍为待决项。本 Runbook 给出操作模板，但不构成已批准的 SLA。发布前必须确认。

### 12.7 其他

- 单 web 实例依赖 entrypoint 迁移；多实例前必须拆独立迁移任务并 `SKIP_DB_MIGRATE=true`。
- nginx 证书/上传限制仅做配置校验，未在非生产演练完整覆盖。
- 分支保护、PR 门禁由 GitHub 管理员配置并验证；本地无法证明失败 PR 会被阻止合并。

---

## 13. 非生产演练结论（E1.8）

演练资源见 [deploy/rehearsal/README.md](../deploy/rehearsal/README.md)，证据在 `docs/stage-artifacts/evidence/sprint-e1/logs/e18-*.log`（`run_id=20261110-105256`）。

### 13.1 已演练验证（本地隔离 Compose，不涉及生产）

| 项目 | 结果 |
|---|---|
| 隔离栈 | 独立项目名/容器名/网络/卷、宿主端口 18080/15432、V1/V2 独立库名；未触碰本地开发容器 |
| 成功路径 | 空库 V1 45 个 / V2 7 个迁移由 entrypoint 执行；`/api/health` 200、`/login` 200、`/v2` 307 跳登录；V2 生产初始化成功；迁移后行数核对通过 |
| 备份/恢复 | `pg_dump -Fc` V1/V2 → `pg_restore` 到临时库 → 关键表行数与迁移历史一致 |
| 增量迁移 | 模拟新版本（V2 7→8）迁移成功；迁移前后业务行数不变；迁移后回滚旧镜像仍健康并冒烟通过（加列/加枚举值向后兼容） |
| 失败停止 | V1/V2 同名目标、不可达数据库（`--connect`/entrypoint 迁移失败）、缺陷镜像健康失败 → 停止且未继续冒烟 |
| 应用镜像回滚 | 缺陷 SHA → 上一版 SHA，`/api/health` 恢复 200、核心冒烟通过；数据库保持前滚 |
| 清理 | `docker compose down -v` 后无残留容器/卷/网络；隔离校验通过 |

本次演练元数据（2026-11-10，`run_id=20261110-105256`，总用时约 5.2 分钟，退出码 0）：

| 项目 | 值 |
|---|---|
| Git 基线 | 分支 `dev`，HEAD `99daac6dbe7ce2028e63d09870d0edcd27e0790b`（未提交改动保留，未提交/推送） |
| 环境 | Docker 29.9.2、Compose v5.6.1、PostgreSQL 18.6、PowerShell 7.4.22 |
| 上一版镜像 `sha-a11c0de`（模拟） | `sha256:e6ed8ef630901b02e3399bc620ac0302bfacc94c4cf89c6ad8d438f650720545`（即预构建镜像 `flower-e05-verification:final`） |
| 新版本镜像 `sha-add1t1`（模拟，含第 8 个 V2 迁移） | `sha256:87be8e277800e0ba8f63c3d765f4ff92aa90a762eb337f839d82a4ee2cbe829d` |
| 缺陷镜像 `sha-badc0de`（模拟，删除 `server.js`） | `sha256:8906c9a92c65e7b07e705feba787041ca1377f2f24a05cc966ca3960ad1ed67a` |

证据文件（`docs/stage-artifacts/evidence/sprint-e1/logs/`，`*` 均为 `20261110-105256`）：

- [`e18-preflight-*.log`](stage-artifacts/evidence/sprint-e1/logs/e18-preflight-20261110-105256.log)：环境/镜像/端口/隔离基线
- [`e18-success-deploy-*.log`](stage-artifacts/evidence/sprint-e1/logs/e18-success-deploy-20261110-105256.log)：迁移、健康、冒烟、初始化、行数
- [`e18-backup-restore-*.log`](stage-artifacts/evidence/sprint-e1/logs/e18-backup-restore-20261110-105256.log)：`pg_dump`/`pg_restore` 与行数核对
- [`e18-incremental-migration-*.log`](stage-artifacts/evidence/sprint-e1/logs/e18-incremental-migration-20261110-105256.log)：7→8 增量迁移与旧镜像兼容
- [`e18-failure-stop-*.log`](stage-artifacts/evidence/sprint-e1/logs/e18-failure-stop-20261110-105256.log)：失败停止三类场景
- [`e18-image-rollback-*.log`](stage-artifacts/evidence/sprint-e1/logs/e18-image-rollback-20261110-105256.log)：镜像回滚与健康恢复
- [`e18-cleanup-*.log`](stage-artifacts/evidence/sprint-e1/logs/e18-cleanup-20261110-105256.log)：清理与隔离校验
- [`e18-summary-*.log`](stage-artifacts/evidence/sprint-e1/logs/e18-summary-20261110-105256.log)：场景结果、边界与残留风险

> 注意：模拟 SHA 标签不对应真实提交，仅用于验证「按提交 SHA 部署/回滚」的机制；
> 真实构建/推送/远程部署未在本地执行（见 13.2）。

### 13.2 仅文档、未在本地验证

- ACR 登录/推送、GitHub Actions `deploy.yml` 真实执行、生产 SSH 远程部署；
- 真实镜像构建（受 npm 镜像与凭据限制）；
- 生产 nginx 边缘/证书/上传限制、生产备份异地保留与恢复窗口；
- 分支保护与 PR 门禁阻止合并；
- 多实例/滚动发布、生产回滚审批流程。

### 13.3 实际恢复边界与残留风险

- 已验证的恢复能力：**应用镜像回滚** + **备份恢复到隔离库**；数据库迁移回退只能依赖备份恢复（本 Runbook 9.2），且需审批与停写窗口。
- 未验证：生产规模数据量下的备份/恢复耗时、OSS 文件一致性、恢复后业务对账。
- 残留风险见第 12 节；其中 12.1（PG18 卷路径）和 12.6（RPO/RTO/恢复责任人）是发布前必须关闭的阻塞项。

---

## 14. 发布记录模板（发布后归档）

```text
发布编号：REL-YYYYMMDD-NN
目标 SHA / 镜像 digest：
上一版 SHA / 镜像 digest：
发布窗口（计划/实际）：
包含迁移：<无 / V1: n 个（列表）/ V2: m 个（列表）>
备份：<路径、大小、sha256、异地副本>
预检结果：<S 编号逐项通过>
迁移结果：<前后 applied 数、耗时、日志要点>
健康检查：<时间、返回体、容器 health>
核心冒烟：<登录/工作台/关键页面/cron/上传>
回滚预案与决定：<未使用 / 使用；原因与审批>
异常与故障单：<编号或“无”>
执行人/复核人/审批人签字：
后续知识更新：<是否需要更新 ADR/已知限制/Runbook>
```

---

## 15. 附录：关键变量与参考

| 变量/路径 | 说明 |
|---|---|
| `DATABASE_URL` | V1 PostgreSQL 连接串（`postgresql://...@db:5432/<v1_db>?schema=public`） |
| `V2_DATABASE_URL` | V2 PostgreSQL 连接串，库名必须与 V1 不同 |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | Auth.js 会话密钥；生产使用随机长字符串，权限 600 |
| `NEXTAUTH_URL` | 生产域名（https） |
| `SKIP_DB_MIGRATE` | 设为 `true` 跳过 entrypoint 迁移（仅限已单独迁移/旧镜像回滚场景） |
| `UPLOAD_MAX_SIZE_MB` | 业务层上传上限（默认 3），须小于 nginx `client_max_body_size`（推荐 5m） |
| `/root/flower-platform/` | ECS 生产目录（compose 与 `.env`） |
| `/root/flower-nginx/` | nginx conf.d 与证书挂载目录 |
| `/root/flower-backups/<TS>/` | 建议的发布备份目录（实际以维护者确认为准） |

参考：

- [GitHub Actions 部署流程](../.github/workflows/deploy.yml)
- [Dockerfile](../Dockerfile) / [docker-compose.example.yml](../docker-compose.example.yml)
- [Nginx 配置说明](../deploy/nginx/README.md)
- [V2 本地运行与初始化](flower-studio-2.0-local-run.md)
- [生产 env 模板](../.env.production.example) / [应用 env 模板](../flower-wms-system/.env.example)
- [ADR-001 V1/V2 过渡、认证与切换](../knowledge/05-ADR/ADR-001-v1-v2-transition.md)
- [ADR-002 V2 数据库、迁移与恢复](../knowledge/05-ADR/ADR-002-v2-database-migration.md)
- [已知限制、试用反馈与技术债](../knowledge/06-Lessons/E0-known-gaps.md)
- [E1.8 演练资源与边界](../deploy/rehearsal/README.md)


