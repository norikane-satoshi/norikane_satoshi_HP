# Booking verification isolation

Google Calendar receives the booking projection; cc-notion mirrors its `source=hp-booking` and
`notion_task_type` markers into IB_仕事. An inherited Calendar ID and refresh token therefore give
a local server access to both production surfaces. Removing only `NOTION_TOKEN` does not isolate
booking tests.

Booking creation, editing, cancellation and reconciliation are enabled only when `NODE_ENV` is
`production`, `VERCEL` is `1`, and `VERCEL_ENV` is `production`. `BOOKING_EXTERNAL_WRITES=disabled`
or an active Vitest runtime disables them even with those deployment markers. Local `next dev`,
local `next start` and Vercel Preview return HTTP 503 (`booking_external_writes_disabled`) before
persisting booking intents. Availability and history reads remain available. Google Calendar
mutation helpers enforce the same policy before creating their provider client.

Production diagnostic booking requests use the existing authenticated `x-chatbot-diagnostic`
header and are also rejected before persistence or notifications. Production customer bookings
without that diagnostic token retain their create/edit/cancel/reconcile behavior.

For verification:

- Run unit tests with mocked provider and persistence dependencies. Existing customer behavior
  fixtures explicitly model Production; isolation regressions exercise the real policy.
- Playwright creates its own local server, forces `BOOKING_EXTERNAL_WRITES=disabled`, and uses
  `E2E_DATABASE_URL` (default `file:./test-results/e2e.db`) for both fixture and migration writes.
  Remote database URLs and external base URLs are rejected. Existing servers are not reused.
- The booking smoke UI uses an isolated DB fixture for its successful receipt. It does not call
  the real booking service or send email, LINE, Calendar or Notion writes. UI success alone is
  not external delivery evidence.
- A manual local submission returns 503. There is no local opt-in to production writes or
  sandbox provider in this implementation.

Set `BOOKING_EXTERNAL_WRITES=disabled` for any separate production-mode verification process.
Do not copy deployment markers into a local runtime to enable writes. Deploying the source and
confirming the running host are separate from these unit tests.
