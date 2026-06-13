#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
: "${HOME:=$(eval echo "~$(id -un)")}"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export CHATBOT_TIER1_ENSURE_CHROME_OPEN_TARGET=0
PNPM="$(command -v pnpm || true)"
if [ -z "$PNPM" ]; then
  echo "pnpm not found under PATH=$PATH" >&2
  exit 1
fi
exec "$PNPM" run chatbot:tier1:ensure-chrome
