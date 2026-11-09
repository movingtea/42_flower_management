#!/bin/sh
set -e

if command -v df >/dev/null 2>&1; then
  echo "[entrypoint] disk usage (container root):"
  df -h / 2>/dev/null | tail -n 1 || true
fi

if [ "${SKIP_DB_MIGRATE:-}" != "true" ]; then
  : "${DATABASE_URL:?DATABASE_URL is required}"
  : "${V2_DATABASE_URL:?V2_DATABASE_URL is required}"
  node scripts/check-v2-database-target.mjs
  echo "[entrypoint] prisma migrate deploy..."
  npx prisma migrate deploy
  npm run db:v2:migrate:deploy
else
  echo "[entrypoint] skip migrations (SKIP_DB_MIGRATE=true)"
fi

exec "$@"
