# Hidden thread inventory

The hosted worker keeps up to two unused, verified-hidden Notion threads in
`~/.local/state/norikane_satoshi_hp/hosted-worker-thread-pool.json` (mode 0600).
This state contains thread URLs and must not be copied into reports or logs.

Startup, completed requests, and an unref'ed 30-second timer request replenishment.
Creation starts only while the customer queue is empty. A dedicated disposable
Chrome page uses the existing authenticated browser context; it is excluded from
customer target selection and closed afterward. An already-started refill does
not block customer generation. The existing seed/hide/verification lifecycle is
reused; no customer inference is performed during replenishment.

Only unused entries younger than seven days with verified `alive=false` and
absence from the Chat list are eligible. Claiming removes and persists the entry
before binding it to a customer conversation. Persistence errors disable the
inventory for that process; the inline creation path remains available. Existing
conversation mappings are never replaced. Heartbeat and named Canary IDs do not
consume customer inventory (only database customer CUIDs are eligible).

Consumption still passes through the existing pre-inference hidden verification
and post-inference lifecycle checks. Used threads are never returned to inventory.
Expired entries are not reused; Notion's existing hidden-thread retention applies.

## Release status, 2026-09-25

Implementation is on a dedicated feature branch, not deployed to the VPS.
The existing worker remains live. SSH access to the recorded endpoint
`chatbot-worker@worker.norikane.studio:22` is blocked: IPv4 connection timeout,
IPv6 `No route to host`. Ping succeeds. No endpoint, authentication, environment,
or infrastructure setting was changed. The repository's deployment guide is
`docs/chatbot-hosted-tier1-heartbeat.md`; it gives the service and installation
paths but not a usable alternative SSH address.

Before deployment, restore the authorized SSH route, use the existing service
deployment procedure, then verify inventory count, unique consumption, hidden
state before/after inference, Canary isolation, and first-turn latency on the
actual worker. Local mocked tests are not live lifecycle proof.
