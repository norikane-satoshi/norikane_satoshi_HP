#!/usr/bin/env bash
set -euo pipefail

export HOME=/Users/norikene_satoshi
export PATH=/opt/homebrew/bin:/usr/local/bin:/Users/norikene_satoshi/.local/bin:/usr/bin:/bin

LOG_DIR="${HOME}/.local/share/hp-41238/logs"
LOG_FILE="${LOG_DIR}/dev.log"
REPO_DIR="${HOME}/projects/norikane_satoshi_HP/.codex-worktrees/staging"

mkdir -p "${LOG_DIR}"

{
  printf '\n[%s] starting hp 41238 dev server\n' "$(date -Iseconds)"
  printf '[%s] cwd=%s\n' "$(date -Iseconds)" "${REPO_DIR}"
  printf '[%s] command=pnpm exec next dev --port 41238 --webpack\n' "$(date -Iseconds)"
} >> "${LOG_FILE}" 2>&1

cd "${REPO_DIR}"
exec /Users/norikene_satoshi/.local/bin/pnpm exec next dev --port 41238 --webpack >> "${LOG_FILE}" 2>&1
