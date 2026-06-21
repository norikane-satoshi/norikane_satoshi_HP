# Chatbot Staging and Production Checklist

This page records the operational contract for chatbot technical-debt cleanup.
It is intentionally a release checklist, not permission to deploy.

## Repository State Contract

- `ChatbotConversation.currentQuestion`, `activeChoices`, and `conversationState` are owned by the repository layer through Prisma fields.
- JSON serialization for `activeChoices` and `conversationState` is centralized in `src/lib/chatbot/server/repository.ts`; do not add ad hoc `JSON.stringify` writes for these fields. If generated Prisma Client lags behind schema on `41238`, only the repository-owned context helpers may use raw SQL to read/write these fields.
- `conversationState.durationContext` is a persisted hint for workflow facts and synced-knowledge status. It is not a deterministic answer table and must not replace the LLM's judgment.
- No schema or Prisma migration is required for the current cleanup. If typed JSON columns are introduced later, migrate with a read-compatible rollout: add columns, dual-write, backfill, read-new/fallback-old, then remove legacy text fields in a separate deploy.

## `turnCount` Contract

- Runtime `conversationState.turnCount` is derived from persisted user messages plus the current user message.
- Stored `conversationState.turnCount` is legacy/debug context only and must not override the derived value during message handling.
- Edit, retry, and history-restore flows must truncate or reload messages first; routing thresholds read the rederived value after that message-set change.

## Local `41238` Script

`scripts/hp-41238-dev.sh` is a machine-local launchd entrypoint for Satoshi's always-on `localhost:41238` surface. It is ignored by git because it contains absolute local paths and is owned by the local supervisor, not the application release.

To recreate it on this machine:

```bash
cat > scripts/hp-41238-dev.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

export HOME=/Users/norikene_satoshi
export PATH=/opt/homebrew/bin:/usr/local/bin:/Users/norikene_satoshi/.local/bin:/usr/bin:/bin

LOG_DIR="${HOME}/.local/share/hp-41238/logs"
LOG_FILE="${LOG_DIR}/dev.log"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

mkdir -p "${LOG_DIR}"
cd "${REPO_DIR}"
/Users/norikene_satoshi/.local/bin/pnpm exec prisma generate >> "${LOG_FILE}" 2>&1
exec /Users/norikene_satoshi/.local/bin/pnpm exec next dev --port 41238 --webpack >> "${LOG_FILE}" 2>&1
EOF
chmod +x scripts/hp-41238-dev.sh
```

The local-tier guard treats an otherwise-current `41238` worktree with dirty files as yellow, not green. After this ignore rule is present in the live worktree, this local script should no longer create dirty count by itself; any remaining yellow means inspect the actual tracked or unignored diff without reset.
The same guard also checks that generated `@prisma/client` schema contains the repository-owned chatbot state fields before treating `41238` as green; if it reports `regenerate-prisma-client-required`, run `pnpm exec prisma generate` before any chatbot runtime verification.

## Staging to Production Audit

Before any production reflection, compare `origin/master..origin/staging` and classify changes by surface:

- chatbot runtime and repository state: API routes, server/domain code, widget state, choice panels, duration context, Notion knowledge sync, hosted Tier 2, local guard
- HP visual/UI: hero, profile, featured works, press section, notes visuals, typography, side peek
- schema and ops: Prisma migrations, env examples, cron/revalidate, launchd/systemd templates, staging baseline guard
- docs/tests: coverage that proves the above

Production release remains blocked until Satoshi gives explicit GO. When GO exists:

1. Fetch `origin/master` and `origin/staging`; verify staging is the intended source SHA.
2. Run `corepack pnpm verify:staging-baseline` on staging and review `origin/master..origin/staging` against the classified allowlist above.
3. Run `corepack pnpm lint`, `corepack pnpm typecheck`, and `corepack pnpm test`; run E2E only with the test env or an explicit release order.
4. Merge forward without reset or force push.
5. Smoke after production deploy: `/`, `/notes/correction`, chatbot open/send, choice panel selection, booking card path, inquiry form fallback, auth-sensitive booking calendar, and no console errors.
6. Rollback by reverting the release commit or redeploying the last known-good production SHA; do not rewrite `master`.
