#!/bin/sh
set -e

if command -v df >/dev/null 2>&1; then
  echo "[entrypoint] disk usage (container root):"
  df -h / 2>/dev/null | tail -n 1 || true
fi

if [ "${SKIP_DB_MIGRATE:-}" != "true" ] && [ -n "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] prisma migrate deploy..."
  npx prisma migrate deploy
else
  echo "[entrypoint] skip migrate (SKIP_DB_MIGRATE=${SKIP_DB_MIGRATE:-} DATABASE_URL set=$([ -n "${DATABASE_URL:-}" ] && echo yes || echo no))"
fi

exec "$@"
