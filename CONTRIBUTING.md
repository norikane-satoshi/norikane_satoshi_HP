# Testing

## Local

- Unit and coverage: `corepack pnpm test:coverage`
- E2E smoke: `corepack pnpm test:e2e`
- Real Resend send: `corepack pnpm e2e:resend:real-send`

`e2e:resend:real-send` is a manual external-send check. It is intentionally outside CI.

## CI Secrets

The unit job does not require production secrets. The E2E job uses an isolated SQLite/libSQL file by default and runs with test-only values for:

- `AUTH_SECRET`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `GOOGLE_CALENDAR_BUSY_SOURCE_ID`

For a dedicated remote Turso test database, add repository secrets with those names and adjust the workflow `env` block to read from secrets instead of the file-backed defaults.
