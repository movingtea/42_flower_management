#!/bin/sh
# Flower WMS Sprint E2 staging：空数据卷首次启动时创建独立 V2 数据库。
# V1 数据库由 POSTGRES_DB 自动创建；V2 库名由 V2_DB_NAME 指定（不得与 V1 同名）。
# 本文件不写入真实凭据；库名白名单防止误指向其他环境。
set -e

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${V2_DB_NAME:?V2_DB_NAME is required}"

case "$V2_DB_NAME" in
  flower_e2_*) ;;
  *)
    echo "[init] refusing unexpected V2_DB_NAME: $V2_DB_NAME" >&2
    exit 1
    ;;
esac

if [ "$V2_DB_NAME" = "$POSTGRES_DB" ]; then
  echo "[init] V2 database must differ from V1 database ($POSTGRES_DB)" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE "$V2_DB_NAME";
EOSQL

echo "[init] created V2 database: $V2_DB_NAME"
