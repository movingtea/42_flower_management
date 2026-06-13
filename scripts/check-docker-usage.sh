#!/usr/bin/env bash
# check-docker-usage.sh — 只读 Docker 磁盘占用检查（不删除任何资源）
#
# Usage: ./scripts/check-docker-usage.sh
set -uo pipefail

log() { printf '%s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }

main() {
  if ! command -v docker >/dev/null 2>&1; then
    warn "docker CLI 未安装（本地开发可忽略；生产宿主机需安装）"
    exit 0
  fi

  log "=== Docker 占用检查 (check-docker-usage.sh) ==="
  log "时间: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log ""

  log "--- docker system df ---"
  docker system df -v 2>/dev/null || docker system df
  log ""

  log "--- 镜像列表（按大小）---"
  docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.ID}}' 2>/dev/null | head -n 30
  log ""

  local stopped
  stopped="$(docker ps -a --filter 'status=exited' -q 2>/dev/null | wc -l | tr -d ' ')"
  log "已停止容器数量: ${stopped}"

  local dangling
  dangling="$(docker images -f 'dangling=true' -q 2>/dev/null | wc -l | tr -d ' ')"
  log "Dangling images 数量: ${dangling}"

  log ""
  log "--- Build cache ---"
  docker builder du 2>/dev/null || docker system df | grep -i build || warn "无法读取 build cache 详情"

  log ""
  log "--- Volume 列表（只读，不删除）---"
  docker volume ls
  log ""
  warn "⛔ PostgreSQL 数据 volume（如 postgres_data）不可自动清理"
  warn "⛔ 禁止执行: docker volume prune / docker system prune -a --volumes"

  log ""
  log "安全清理: ./scripts/safe-docker-prune.sh 或 ./scripts/deploy-cleanup.sh"
  log "=== 检查完成 ==="
}

main "$@"
