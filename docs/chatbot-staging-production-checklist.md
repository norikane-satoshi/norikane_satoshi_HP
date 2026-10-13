# Chatbot Staging and Production Checklist

This page records the operational contract for chatbot technical-debt cleanup.
It is intentionally a release checklist, not permission to deploy.

## Repository State Contract

- `ChatbotConversation.currentQuestion`, `activeChoices`, and `conversationState` are owned by the repository layer through Prisma fields.
- JSON serialization for `activeChoices` and `conversationState` is centralized in `src/lib/chatbot/server/repository.ts`; do not add ad hoc `JSON.stringify` writes for these fields. If generated Prisma Client lags behind schema, only the repository-owned context helpers may use raw SQL to read/write these fields.
- `conversationState.durationContext` is a persisted hint for workflow facts and synced-knowledge status. It is not a deterministic answer table and must not replace the LLM's judgment.
- No schema or Prisma migration is required for the current cleanup. If typed JSON columns are introduced later, migrate with a read-compatible rollout: add columns, dual-write, backfill, read-new/fallback-old, then remove legacy text fields in a separate deploy.

## `turnCount` Contract

- Runtime `conversationState.turnCount` is derived from persisted user messages plus the current user message.
- Stored `conversationState.turnCount` is legacy/debug context only and must not override the derived value during message handling.
- Edit, retry, and history-restore flows must truncate or reload messages first; routing thresholds read the rederived value after that message-set change.

## Staging to Production Audit

Before any production reflection, compare `origin/master..origin/staging` and classify changes by surface:

- chatbot runtime and repository state: API routes, server/domain code, widget state, choice panels, duration context, Notion knowledge sync
- HP visual/UI: hero, profile, featured works, press section, notes visuals, typography, side peek
- schema and ops: Prisma migrations, env examples, cron/revalidate, staging baseline guard
- docs/tests: coverage that proves the above

Production release remains blocked until Satoshi gives explicit GO. When GO exists:

1. Fetch `origin/master` and `origin/staging`; verify staging is the intended source SHA.
2. Run `corepack pnpm verify:staging-baseline` on staging and review `origin/master..origin/staging` against the classified allowlist above.
3. Run `corepack pnpm lint`, `corepack pnpm typecheck`, and `corepack pnpm test`; run E2E only with the test env or an explicit release order.
4. Merge forward without reset or force push.
5. Smoke after production deploy: `/`, `/notes/correction`, chatbot open/send, choice panel selection, booking card path, inquiry form fallback, auth-sensitive booking calendar, and no console errors.
6. Rollback by reverting the release commit or redeploying the last known-good production SHA; do not rewrite `master`.

## Full-Test Fallback Customer-Experience Gate

Every full chatbot verification must include the fallback customer experience. Health checks and configured environment variables are prerequisites, not proof that a customer can complete the flow.

Run the permanent live verifier once against the release target:

```bash
pnpm chatbot:verify-fallback-customer-experience-live -- --base-url https://norikane.studio
```

The tier order is Tier0 (deterministic intake, no model) → `tier-2-gemini-flash` → `tier-3-form-fallback`. The command uses controlled failure injection. It must prove all of the following in one pass:

1. The real `tier-2-gemini-flash` client answers.
2. The real Gemini response contains the canary and satisfies the customer display contract with structured UI.
3. A Tier 2 health failure selects `tier-3-form-fallback` with the canonical inquiry-form guidance.
4. The real `/api/chatbot/submit-inquiry` route returns both `ok: true` and `delivered: true`; HTTP 200 alone is a failure.
5. The unit and E2E suites prove the resulting `tier3-inquiry-form` is visible, submit targets `/api/chatbot/submit-inquiry`, success feedback is visible, and fallback Slack notifications use the current tier labels.
6. The verifier report contains only tier labels and boolean contract evidence. It must not print API keys, email addresses, prompts, response bodies, or customer data.

`tier-0-deterministic-intake` is not a fallback. It is the normal reply for intake turns that code fully decides (a confirmed choice-panel answer, or a required free-text intake answer that advanced the state); no model is called and the reply is the fixed next question. First messages, customer questions, knowledge answers, protective branches, and clarifications go to Tier 2. A free-text answer to a shown panel is mapped by TypeSafe Jev only when `TYPESAFE_API_KEY` is set and the answer is confident; otherwise it goes to Tier 2.

The live command sends one clearly labelled canary notification to the operator. Record only the target SHA, execution time, tier results, delivery boolean, and the provider/message identifier when separately available. Never record the canary email body or credentials.
