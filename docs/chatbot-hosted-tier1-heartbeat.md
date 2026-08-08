# Hosted Tier1 Heartbeat

`tier-1-hosted-chrome-notion-ai` is monitored from the VPS, not from Satoshi's Mac or `localhost:41238`.

Runtime shape:

- `studio.norikane.hosted-tier1-heartbeat.timer` runs every 2 minutes as a systemd user timer.
- Each heartbeat run checks the VPS loopback worker (`http://127.0.0.1:8787` by default) with bearer auth, so worker JSON error codes stay visible instead of being flattened by the public tunnel.
- Production chatbot preflight uses quick `GET /health?mode=quick` so an active Notion AI generation or CDP runtime inspection spike does not skip Tier1 before `/generate`.
- If the hosted Tier1 health probe times out or returns a retryable connection failure, Production still attempts `/generate`; fallback to Tier2 starts only after Tier1 generate exhausts its own repair/retry budget.
- A lightweight `POST /generate` smoke runs every 30 minutes by default; the 2-minute timer still performs the cheap health check. It used to run every 10 minutes, but each smoke appends a turn to the Notion AI thread the worker posts from (~144 turns a day against a handful of real consultations), and that thread has a storage limit. Thirty minutes triples its life at the cost of escalating a generic outage in ~30-60 min instead of ~20-25.
- One failed health/connection run moves state to `unhealthy`; transient hosted Notion AI `invalid-output` and `rate-limit` generate misses stay `suspect` until `CHATBOT_HOSTED_TIER1_HEARTBEAT_TRANSIENT_GENERATE_FAILURE_THRESHOLD` consecutive misses (default 2, so a sustained Notion-side outage escalates on the second generate sample instead of the third).
- Tier1 generate failure is not treated as a successful lower-tier fallback.
- On the first unhealthy transition, the script tries one repair sequence: `POST /ensure-chrome`, `systemctl --user restart hosted-notion-ai-worker.service`, then `systemctl --user restart hosted-worker-chrome.service`.
- Notion trust-rule, hosted Notion AI `invalid-output`, and hosted Notion AI `rate-limit` failures skip restart loops because service restarts do not fix model/extraction/quota responses.
- `notion_ai_thread_capacity` is its own incident class and escalates on the first sample rather than waiting for the transient threshold. It means the worker's Notion AI thread is out of storage; the worker rotates itself and only a *failed* rotation reaches this class. Restarting services does not help, so it skips the repair sequence too.
- A successful rotation is announced once as a `thread-rotated` notification, driven by `notionThread.threadId` in `/health` changing from the id the heartbeat last saw. The first observation never notifies, so a fresh state file does not page.
- Notifications are state-change only: `unhealthy` and `recovered`. `recovered` is sent only after an `unhealthy` notification was actually sent/dry-run for the active incident; rate-limited or unnotified unhealthy samples do not create recovered spam. Slack is primary when configured; Resend email remains fallback.
- Logs are JSONL and do not include bearer tokens, raw prompts, raw model output, cookies, or personal request bodies.
- When `/health` is ready but `/generate` fails, JSONL and Slack mark `incident_kind: health_ok_generate_failed` with phase, HTTP status, duration, sanitized worker error code/message preview, and repair action summary.
- Chatbot Slack/Vercel structured logs include sanitized retry attempt summaries: attempt number, outcome, reason, duration, timeout, HTTP status, and retryability only.
- `invalid-output` answers with HTTP 500, not 502. Cloudflare replaces an origin 502 with its own plain-text error page, so a 502 hides the worker error code, message, and retryable flag from Production and from every probe outside the VPS loopback. Diagnosing the 2026-08-06 outage required SSH for exactly that reason.
- Production honours the worker's `retryable: false` on 5xx instead of retrying every server error. Notion returning an empty inference stream (`bytes=0`, HTTP 200 `application/x-ndjson`) lasts minutes, so exhausting the retry budget only delays the Tier2 answer the customer receives.
- Timeout budgets are aligned so the worker does not abort Notion AI at 50s while the Production client still has budget: worker generate default 70s, client attempt default 75s, total Tier1 budget 90s, `/api/chatbot/message` maxDuration 120s.

Default VPS files:

- env: `~/.config/norikane/hosted-tier1-heartbeat.env`
- state: `~/.local/state/norikane_satoshi_hp/hosted-tier1-heartbeat-state.json`
- log: `~/.local/state/norikane_satoshi_hp/hosted-tier1-heartbeat.jsonl`
- service template: `scripts/chatbot/studio.norikane.hosted-tier1-heartbeat.service.template`
- timer template: `scripts/chatbot/studio.norikane.hosted-tier1-heartbeat.timer.template`

Required env keys stay on the VPS only:

- `CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN`
- `SLACK_BOT_TOKEN` plus `CHATBOT_HOSTED_TIER1_HEARTBEAT_SLACK_CHANNEL`, or `CHATBOT_HOSTED_TIER1_HEARTBEAT_SLACK_WEBHOOK_URL`

Optional env keys:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `CHATBOT_HOSTED_NOTION_AI_WORKER_URL` (default: `http://127.0.0.1:8787`)
- `CHATBOT_HOSTED_TIER1_HEARTBEAT_NOTIFY_EMAIL`
- `CHATBOT_HOSTED_TIER1_HEARTBEAT_GENERATE_INTERVAL_MS`
- `CHATBOT_HOSTED_TIER1_HEARTBEAT_GENERATE_TIMEOUT_MS`
- `CHATBOT_HOSTED_TIER1_HEARTBEAT_FAILURE_THRESHOLD`
- `CHATBOT_HOSTED_TIER1_HEARTBEAT_TRANSIENT_GENERATE_FAILURE_THRESHOLD`
- `CHATBOT_HOSTED_TIER1_HEARTBEAT_NOTIFICATION_COOLDOWN_MS`
- `CHATBOT_HOSTED_TIER1_HEARTBEAT_DRY_RUN_NOTIFY`

Install on the VPS after copying the repo branch:

```bash
mkdir -p ~/.config/systemd/user ~/.config/norikane
cp scripts/chatbot/studio.norikane.hosted-tier1-heartbeat.service.template ~/.config/systemd/user/studio.norikane.hosted-tier1-heartbeat.service
cp scripts/chatbot/studio.norikane.hosted-tier1-heartbeat.timer.template ~/.config/systemd/user/studio.norikane.hosted-tier1-heartbeat.timer
systemctl --user daemon-reload
systemctl --user enable --now studio.norikane.hosted-tier1-heartbeat.timer
```

The live VPS worker repo is `/home/chatbot-worker/norikane_satoshi_HP`; do not switch its branch just to install the heartbeat because the worker service also runs from that directory. Reconcile from the approved master commit, then copy only the heartbeat service/timer templates or script when the web app code does not require a Vercel deploy.

Do not commit the env file.
