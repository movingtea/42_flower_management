#!/usr/bin/env bash
# deploy-cleanup.sh — Post-deploy safe Docker disk cleanup (run on the host)
#
# Run AFTER `docker compose up -d` succeeds. Waits for core service healthchecks,
# then prunes stopped containers, dangling images, unused networks, and old build cache.
#
# ── Disk safety red lines (NEVER run by default) ─────────────────────────────
#   docker volume prune
#   docker system prune --volumes
#   docker system prune -a --volumes -f
#   rm -rf public/uploads
#   rm -rf /var/lib/docker/volumes
#   Deleting postgres_data volume or any compose project volumes
#   Removing images/networks/containers still in use by this stack
#
# This script does NOT delete:
#   - Docker volumes (postgres_data, next-cache, etc.)
#   - public/uploads
#   - Running containers (flower-web, db, nginx, cron-worker)
#
# Usage:
#   ./scripts/deploy-cleanup.sh              # safe mode (default)
#   ./scripts/deploy-cleanup.sh --aggressive # more aggressive, still no volumes
#   ./scripts/deploy-cleanup.sh --timeout 180
#   ./scripts/deploy-cleanup.sh --compose-file /path/to/docker-compose.yml
#
set -uo pipefail

AGGRESSIVE=false
TIMEOUT_SECONDS=120
COMPOSE_FILE=""
COMPOSE_PROJECT=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: deploy-cleanup.sh [OPTIONS]

Post-deploy safe Docker cleanup. Waits for flower-web (and db) healthchecks before pruning.

Options:
  --aggressive       Prune unused images/build cache older than 72h (still no volumes)
  --timeout SECONDS  Max wait for healthchecks (default: 120)
  --compose-file F   Path to docker-compose.yml (default: repo root)
  --project NAME     Docker Compose project name (optional)
  -h, --help         Show this help

Safe mode prunes:
  docker container prune -f
  docker image prune -f
  docker network prune -f
  docker builder prune -f --filter until=24h

Aggressive mode additionally allows:
  docker image prune -a -f --filter until=72h
  docker builder prune -a -f --filter until=72h

Never runs: docker volume prune, docker system prune --volumes
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --aggressive) AGGRESSIVE=true; shift ;;
    --timeout) TIMEOUT_SECONDS="${2:?--timeout requires seconds}"; shift 2 ;;
    --compose-file) COMPOSE_FILE="${2:?--compose-file requires path}"; shift 2 ;;
    --project) COMPOSE_PROJECT="${2:?--project requires name}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -z "${COMPOSE_FILE}" ]]; then
  if [[ -f "${REPO_ROOT}/docker-compose.yml" ]]; then
    COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
  else
    echo "[error] docker-compose.yml not found under ${REPO_ROOT}" >&2
    exit 1
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[error] docker CLI not found; run this script on the Docker host." >&2
  exit 1
fi

compose() {
  local args=(-f "${COMPOSE_FILE}")
  if [[ -n "${COMPOSE_PROJECT}" ]]; then
    args+=(-p "${COMPOSE_PROJECT}")
  fi
  docker compose "${args[@]}" "$@"
}

log() { printf '%s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
err() { printf 'ERROR: %s\n' "$*" >&2; }

print_disk_state() {
  local label="$1"
  log ""
  log "=== ${label} ==="
  df -h / 2>/dev/null || df -h
  log ""
  docker system df 2>/dev/null || warn "docker system df failed"
}

# Returns 0 if service has a healthcheck defined in image/compose config.
service_has_healthcheck() {
  local service="$1"
  local cid
  cid="$(compose ps -q "${service}" 2>/dev/null | head -n1)"
  if [[ -z "${cid}" ]]; then
    return 1
  fi
  local status
  status="$(docker inspect --format '{{if .Config.Healthcheck}}{{if .Config.Healthcheck.Test}}yes{{end}}{{end}}' "${cid}" 2>/dev/null || true)"
  [[ "${status}" == "yes" ]]
}

# wait_for_healthy SERVICE_NAME TIMEOUT_SECONDS
# - healthy  -> 0
# - no healthcheck -> checks Running; warns; returns 0 if running
# - unhealthy / timeout / not running -> 1
wait_for_healthy() {
  local service="$1"
  local timeout="$2"
  local elapsed=0
  local interval=5
  local cid=""
  local has_hc=false

  log ""
  log "[wait] Checking service: ${service} (timeout ${timeout}s)"

  while [[ ${elapsed} -le ${timeout} ]]; do
    cid="$(compose ps -q "${service}" 2>/dev/null | head -n1)"
    if [[ -z "${cid}" ]]; then
      if [[ ${elapsed} -ge ${timeout} ]]; then
        err "${service}: no container found after ${timeout}s"
        return 1
      fi
      sleep "${interval}"
      elapsed=$((elapsed + interval))
      continue
    fi

    if [[ "${has_hc}" == "false" ]] && service_has_healthcheck "${service}"; then
      has_hc=true
    fi

    if [[ "${has_hc}" == "true" ]]; then
      local health
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${cid}" 2>/dev/null || echo "unknown")"
      case "${health}" in
        healthy)
          log "[ok] ${service} is healthy"
          return 0
          ;;
        unhealthy)
          err "${service} is unhealthy"
          return 1
          ;;
        starting|none|unknown)
          log "[wait] ${service} health=${health} (${elapsed}s/${timeout}s)"
          ;;
      esac
    else
      local running
      running="$(docker inspect --format '{{.State.Running}}' "${cid}" 2>/dev/null || echo "false")"
      if [[ "${running}" == "true" ]]; then
        warn "${service} has no healthcheck; container is running (not blocking cleanup)"
        return 0
      fi
      log "[wait] ${service} not running yet (${elapsed}s/${timeout}s)"
    fi

    sleep "${interval}"
    elapsed=$((elapsed + interval))
  done

  err "${service}: timed out after ${timeout}s"
  return 1
}

run_safe_prune() {
  log ""
  log "=== Running safe Docker prune ==="

  if [[ "${AGGRESSIVE}" == "true" ]]; then
    warn "AGGRESSIVE mode: pruning unused images and build cache older than 72h."
    warn "Still NOT pruning volumes or running containers."
    docker container prune -f
    docker image prune -a -f --filter "until=72h"
    docker network prune -f
    docker builder prune -a -f --filter "until=72h"
  else
    docker container prune -f
    docker image prune -f
    docker network prune -f
    docker builder prune -f --filter "until=24h"
  fi
}

main() {
  log "deploy-cleanup.sh — compose file: ${COMPOSE_FILE}"
  log "Mode: $([[ "${AGGRESSIVE}" == "true" ]] && echo aggressive || echo safe)"
  log "Healthcheck timeout: ${TIMEOUT_SECONDS}s"

  print_disk_state "Disk usage BEFORE cleanup"

  local failed=false

  if ! wait_for_healthy "flower-web" "${TIMEOUT_SECONDS}"; then
    failed=true
  fi

  if service_has_healthcheck "db"; then
    if ! wait_for_healthy "db" "${TIMEOUT_SECONDS}"; then
      failed=true
    fi
  else
    warn "db has no healthcheck in running container; skipping db health wait"
  fi

  # nginx is optional — only wait if it defines a healthcheck
  if compose config --services 2>/dev/null | grep -qx 'flower-nginx'; then
    if service_has_healthcheck "flower-nginx"; then
      if ! wait_for_healthy "flower-nginx" "${TIMEOUT_SECONDS}"; then
        failed=true
      fi
    fi
  fi

  if [[ "${failed}" == "true" ]]; then
    err "Core service healthcheck failed — skipping prune to avoid disrupting a broken deploy."
    print_disk_state "Disk usage (cleanup SKIPPED)"
    exit 1
  fi

  log ""
  log "[ok] Core services healthy — proceeding with safe prune"

  # Prune failures must not stop running services; log and continue.
  if ! run_safe_prune; then
    warn "One or more prune commands failed; running containers are unaffected."
  fi

  print_disk_state "Disk usage AFTER cleanup"
  log ""
  log "[done] Post-deploy cleanup finished."
  exit 0
}

main "$@"
