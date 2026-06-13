#!/usr/bin/env bash
# safe-docker-prune.sh — 安全清理 Docker 无用资源（绝不清理 volumes / PostgreSQL 数据）
#
# 允许: stopped containers, dangling images, unused networks, build cache
# 禁止: docker volume prune, docker system prune -a --volumes, rm -rf /var/lib/docker
#
# Usage:
#   ./scripts/safe-docker-prune.sh
#   DRY_RUN=true ./scripts/safe-docker-prune.sh
set -uo pipefail

DRY_RUN="${DRY_RUN:-false}"

log() { printf '%s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
err() { printf 'ERROR: %s\n' "$*" >&2; }

run_cmd() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    log "[DRY_RUN] $*"
  else
    log "[exec] $*"
    "$@"
  fi
}

parse_root_use_percent() {
  df -P / 2>/dev/null | awk 'NR==2 { gsub(/%/,"",$5); print $5 }'
}

print_disk_state() {
  local label="$1"
  log ""
  log "=== ${label} ==="
  df -h / 2>/dev/null || df -h
  log ""
  if command -v docker >/dev/null 2>&1; then
    docker system df 2>/dev/null || warn "docker system df failed"
  fi
}

main() {
  log "╔══════════════════════════════════════════════════════════════╗"
  log "║  safe-docker-prune.sh — 安全 Docker 清理                      ║"
  log "║  ✓ 清理: 停止的容器 / dangling 镜像 / 未用网络 / build cache  ║"
  log "║  ✗ 不清理: volumes / postgres_data / 运行中容器               ║"
  log "║  ✗ 禁止: docker volume prune / system prune --volumes         ║"
  log "╚══════════════════════════════════════════════════════════════╝"
  log ""
  if [[ "${DRY_RUN}" == "true" ]]; then
    warn "DRY_RUN=true — 仅显示将执行的命令，不实际删除"
  fi

  if ! command -v docker >/dev/null 2>&1; then
    err "docker CLI 未找到，请在 Docker 宿主机运行"
    exit 1
  fi

  print_disk_state "清理前磁盘 / Docker 占用"

  log ""
  log "=== 开始安全 prune ==="
  run_cmd docker container prune -f
  run_cmd docker image prune -f
  run_cmd docker network prune -f
  run_cmd docker builder prune -f

  print_disk_state "清理后磁盘 / Docker 占用"

  local use_pct
  use_pct="$(parse_root_use_percent)"
  if [[ -n "${use_pct}" ]] && [[ "${use_pct}" =~ ^[0-9]+$ ]] && [[ "${use_pct}" -ge 90 ]]; then
    warn "清理后根分区仍 >= 90% (${use_pct}%)，请人工排查："
    warn "  - du -sh /var/lib/docker"
    warn "  - ./scripts/check-disk-space.sh"
    warn "  - 考虑扩容磁盘；勿执行 docker volume prune"
    exit 2
  fi

  log ""
  log "[done] safe-docker-prune 完成"
}

main "$@"
