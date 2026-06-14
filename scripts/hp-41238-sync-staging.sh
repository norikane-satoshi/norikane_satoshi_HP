#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/Users/norikene_satoshi}"
export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO_ROOT="${HOME}/projects/norikane_satoshi_HP"
LIVE_WORKTREE="${REPO_ROOT}/.codex-worktrees/staging"
LABEL="com.norikane.hp41238"
READY_URL="http://127.0.0.1:41238/"
LOG_DIR="${HOME}/.local/share/hp-41238/logs"
LOG_FILE="${LOG_DIR}/staging-sync.log"

mkdir -p "${LOG_DIR}"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*" >> "${LOG_FILE}"
}

require_clean_live_worktree() {
  if [[ -n "$(git -C "${LIVE_WORKTREE}" status --porcelain --untracked-files=no)" ]]; then
    log "blocked: live worktree has tracked changes"
    git -C "${LIVE_WORKTREE}" status --short >&2
    exit 1
  fi
}

wait_ready() {
  local attempt
  local code

  for attempt in $(seq 1 60); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${READY_URL}" || true)"
    if [[ "${code}" == "200" ]]; then
      log "ready: ${READY_URL} http=${code}"
      printf '%s\n' "${code}"
      return 0
    fi
    sleep 1
  done

  log "blocked: ${READY_URL} did not return 200"
  return 1
}

main() {
  local old_head
  local target_head
  local old_lock
  local new_lock
  local changed=false

  log "sync start"

  git -C "${REPO_ROOT}" fetch origin staging

  old_head="$(git -C "${LIVE_WORKTREE}" rev-parse HEAD)"
  target_head="$(git -C "${REPO_ROOT}" rev-parse --verify refs/remotes/origin/staging^{commit})"

  require_clean_live_worktree

  old_lock="$(git -C "${LIVE_WORKTREE}" rev-parse HEAD:pnpm-lock.yaml 2>/dev/null || true)"
  new_lock="$(git -C "${REPO_ROOT}" rev-parse "${target_head}:pnpm-lock.yaml" 2>/dev/null || true)"

  if [[ "${old_head}" != "${target_head}" ]]; then
    git -C "${LIVE_WORKTREE}" checkout --detach "${target_head}"
    log "checked out live worktree: ${old_head} -> ${target_head}"
    changed=true
  else
    log "live worktree already at ${target_head}"
  fi

  if [[ -n "${old_lock}" && -n "${new_lock}" && "${old_lock}" != "${new_lock}" ]]; then
    log "pnpm-lock changed; running pnpm install --frozen-lockfile"
    (cd "${LIVE_WORKTREE}" && pnpm install --frozen-lockfile) >> "${LOG_FILE}" 2>&1
  fi

  if [[ "${changed}" != "true" ]]; then
    log "sync complete unchanged target=${target_head}"
    return 0
  fi

  launchctl kickstart -k "gui/$(id -u)/${LABEL}"
  log "launchctl kickstart completed"
  wait_ready > /dev/null
  log "sync complete target=${target_head}"
}

main "$@"
