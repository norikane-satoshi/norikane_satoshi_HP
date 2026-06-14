#!/usr/bin/env bash
set -euo pipefail

should_sync=false

while read -r local_ref _local_sha remote_ref _remote_sha; do
  if [[ "${remote_ref}" == "refs/heads/staging" || "${local_ref}" == "refs/heads/staging" ]]; then
    should_sync=true
  fi
done

if [[ "${should_sync}" != "true" ]]; then
  exit 0
fi

SCRIPT_CANDIDATES=(
  "$(git rev-parse --show-toplevel)/scripts/hp-41238-sync-staging.sh"
  "/Users/norikene_satoshi/projects/norikane_satoshi_HP/.codex-worktrees/staging-featured-player/scripts/hp-41238-sync-staging.sh"
  "/Users/norikene_satoshi/projects/norikane_satoshi_HP/.codex-worktrees/staging/scripts/hp-41238-sync-staging.sh"
)

for script_path in "${SCRIPT_CANDIDATES[@]}"; do
  if [[ -x "${script_path}" ]]; then
    exec "${script_path}"
  fi
done

printf 'hp-41238 post-push hook: sync script not found\n' >&2
exit 1
