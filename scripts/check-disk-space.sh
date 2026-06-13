#!/usr/bin/env bash
# check-disk-space.sh — 只读磁盘空间检查（宿主机安全运行，不删除任何文件）
#
# Usage: ./scripts/check-disk-space.sh
# Exit:  0 = OK or WARNING (<90%); 2 = CRITICAL (>=90%)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TOP_N="${TOP_N:-5}"

log() { printf '%s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
crit() { printf 'CRITICAL: %s\n' "$*" >&2; }

parse_root_use_percent() {
  df -P / 2>/dev/null | awk 'NR==2 { gsub(/%/,"",$5); print $5 }'
}

du_safe() {
  local path="$1"
  if [[ -d "${path}" ]] && [[ -r "${path}" ]]; then
    du -sh "${path}" 2>/dev/null | awk '{print $1 "\t" $2}' || echo "N/A\t${path}"
  else
    echo "N/A\t${path} (不可读或不存在)"
  fi
}

main() {
  log "=== 磁盘空间检查 (check-disk-space.sh) ==="
  log "时间: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log ""

  log "--- df -h ---"
  df -h 2>/dev/null || df -h
  log ""

  local use_pct
  use_pct="$(parse_root_use_percent)"
  if [[ -z "${use_pct}" ]] || ! [[ "${use_pct}" =~ ^[0-9]+$ ]]; then
    warn "无法解析根分区使用率"
    exit 1
  fi

  log "根分区 (/) 使用率: ${use_pct}%"

  if [[ "${use_pct}" -ge 90 ]]; then
    crit "根分区使用率 ${use_pct}% >= 90%，磁盘空间严重不足"
  elif [[ "${use_pct}" -ge 80 ]]; then
    warn "根分区使用率 ${use_pct}% >= 80%，建议尽快清理或扩容"
  else
    log "状态: OK (<80%)"
  fi

  log ""
  log "--- Docker 占用摘要 ---"
  if command -v docker >/dev/null 2>&1; then
    docker system df 2>/dev/null || warn "docker system df 失败"
  else
    warn "未安装 docker CLI，跳过 docker system df"
  fi

  log ""
  log "--- 目录占用 Top ${TOP_N}（du -sh，只读）---"

  local -a paths=(
    "/var/lib/docker"
    "${REPO_ROOT}"
    "${REPO_ROOT}/flower-wms-system"
    "${REPO_ROOT}/flower-wms-system/public/uploads"
    "/var/log"
  )

  for path in "${paths[@]}"; do
    du_safe "${path}"
  done | sort -hr 2>/dev/null | head -n "${TOP_N}" || true

  log ""
  log "提示: 磁盘不足可能导致 Prisma getaddrinfo EAI_AGAIN db、502、容器 unhealthy。"
  log "清理请使用: ./scripts/safe-docker-prune.sh（不清理 volumes）"
  log "=== 检查完成 ==="

  if [[ "${use_pct}" -ge 90 ]]; then
    exit 2
  fi
  exit 0
}

main "$@"
