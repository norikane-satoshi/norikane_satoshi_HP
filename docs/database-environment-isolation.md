# Database environment isolation

| Runtime | Database | Migration |
| --- | --- | --- |
| Vercel Production | `norikane-studio` | Existing Production build migration |
| Vercel Preview, including `staging` and other branches | `norikane-studio-preview` | Manual migration; automatic Preview build migration stays skipped |
| Vercel Development | `norikane-studio-preview` | Manual migration |
| Local development and verification | Local SQLite recommended, for example `file:./dev.db` | `prisma migrate deploy` for SQLite |

Set `TURSO_DATABASE_URL` and its matching `TURSO_AUTH_TOKEN` in the Vercel environment that uses
the database. Preview and Development use a token issued for `norikane-studio-preview`. Keep the
Production variables and database unchanged. A URL and token must belong to the same database;
changing only the URL does not create an isolated credential configuration. Preview branch
overrides must also use the dedicated database.

## Connection policy

`src/lib/database-target-policy.mjs` identifies the known production and preview Turso database
host labels, including regional and non-regional endpoints. The production database is allowed
only with `NODE_ENV=production`, `VERCEL=1`, `VERCEL_ENV=production`, and no active Vitest runtime.
Local `next start` is therefore still a non-Production runtime. Local SQLite and dedicated
preview databases are allowed without deployment markers.

The guard runs before the Prisma adapter is created and before any cached Prisma client is
returned. A non-Production runtime inheriting the production target fails with
`production_database_access_disabled`. The URL and token never appear in that error.

The same guard protects the Turso migration policy, chatbot local Prisma helper, seed, Step 0
backfill, email redirect verification fixtures, and browser console booking cleanup. These
helpers cannot use inherited production credentials from a local shell. For the local chatbot
helper and seed, the guard also checks a URL selected through `PRISMA_MIGRATE_DATABASE_URL`.

The database guard is separate from `bookingExternalWritesEnabled`: using an isolated DB does
not enable Preview Calendar, Notion, email, or other booking provider mutations. See
`booking-verification-isolation.md` for the provider policy.

## Preview setup and migration

1. Create `norikane-studio-preview` as an empty database. Do not clone customer data from
   `norikane-studio`.
2. Set the dedicated URL and token for all Vercel Preview branches and Vercel Development.
   Check branch-specific overrides and leave Production settings unchanged. Rebuild the Preview
   deployment after updating its environment.
3. In an authenticated local shell, supply the dedicated preview `TURSO_DATABASE_URL` and
   `TURSO_AUTH_TOKEN` from the approved secret source. Leave Vercel deployment markers unset and
   run `ws run -- pnpm db:migrate:turso` from a managed worktree. The script loads `.env.local`
   and `.env` with `override: false`; supplied process variables take precedence. Do not copy a
   Production env file or print credentials.
4. Check the migration result and query `GET /api/chatbot/build-info` on the deployed Preview.
   Its `database` must be `{ "role": "preview", "identifier": "norikane-studio-preview" }`.
   This reports the configured target; verify application DB access separately. The endpoint
   performs no database connection and exposes only fixed allowlisted identities.

Vercel non-Production builds continue to skip automatic migrations. An inherited production
target is rejected before that skip decision, so a misconfigured Preview build fails closed.
Production migration execution remains enabled under its existing deployment markers. Do not
set those markers locally to bypass isolation.

## Local SQLite

Set both `TURSO_DATABASE_URL` and `PRISMA_MIGRATE_DATABASE_URL` to the same absolute SQLite
URL, for example `file:/absolute/worktree/dev.db`, so the runtime and Prisma CLI use the same
file. Apply the repository migrations with `pnpm exec prisma migrate deploy` before running
the app. A Turso auth token is unnecessary for local SQLite.

Existing local env files are not rewritten by this guard. If one still selects the production
database, the local runtime rejects it until the operator explicitly selects an isolated target.

## Local development with the Preview database

Use the Development environment's dedicated Preview URL and matching token from the approved
secret source for `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in the ignored `.env.local`.
Leave `VERCEL` and `VERCEL_ENV` unset. Preserve unrelated local settings and never print either
value. Local development then shares only disposable Preview conversation data, not customer
records. Prefer SQLite above when independent fixtures are needed.

After changing the local settings, check the database role with `getDatabaseTarget` and require
`preview` (or `local` for SQLite). A safe environment pull can preserve an existing nonempty
value when Vercel returns an empty encrypted value, so a successful pull alone does not prove
that the old Production URL was replaced. The runtime guard must remain enabled.

Diagnostics return `production` / `norikane-studio`, `preview` / `norikane-studio-preview`,
`local` / `local-sqlite`, or `unknown` / `unknown`. Unrecognized dedicated remote databases are
allowed and reported as `unknown`; arbitrary hosts, paths, query strings, and tokens are never
included in this diagnostic.
