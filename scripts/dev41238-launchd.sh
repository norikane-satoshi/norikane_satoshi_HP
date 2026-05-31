#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

worktree="/Users/norikene_satoshi/projects/norikane_satoshi_HP-hosted-worker-tier2-client"
log_dir="/Users/norikene_satoshi/.local/share/norikane-hosted-worker/logs"
log_path="${log_dir}/dev41238.log"

mkdir -p "${log_dir}"
cd "${worktree}"

{
  printf '\n[%s] starting dev server on 41238\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  exec npm run dev -- --port 41238
} >>"${log_path}" 2>&1
