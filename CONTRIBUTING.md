# Testing

## Local

- Unit and coverage: `corepack pnpm test:coverage`
- E2E smoke: `corepack pnpm test:e2e`
- Real Resend send: `corepack pnpm e2e:resend:real-send`

`e2e:resend:real-send` is a manual external-send check. It is intentionally outside CI.

## Staging Baseline

Before updating or restoring the 41238 staging branch from a known-good staging baseline, run:

`corepack pnpm verify:staging-baseline`

Default mode compares against the last intentionally verified `origin/staging` baseline and should only allow this guard's own maintenance files. For a scoped integration, pass the previous staging tip plus exact changed files:

`corepack pnpm verify:staging-baseline -- --base <previous-staging-sha> --allow <path> --allow <path>`

Keep this check read-only. Do not replace the exact path allowlist with wildcards; update the default baseline only after `origin/staging` has intentionally advanced and the default diff has been reviewed.

## CI Secrets

The unit job does not require production secrets. The E2E job uses an isolated SQLite/libSQL file by default and runs with test-only values for:

- `AUTH_SECRET`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `GOOGLE_CALENDAR_BUSY_SOURCE_ID`

For a dedicated remote Turso test database, add repository secrets with those names and adjust the workflow `env` block to read from secrets instead of the file-backed defaults.
