#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

export PATH="/opt/homebrew/bin:/usr/bin:/bin"

PNPM="$(command -v pnpm)"
exec "$PNPM" run chatbot:tier1:ensure-chrome
