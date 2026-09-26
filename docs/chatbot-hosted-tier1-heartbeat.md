# Hosted Tier1 Heartbeat

`tier-1-hosted-chrome-notion-ai` is monitored from the VPS, not from Satoshi's Mac or `localhost:41238`.

Runtime shape:

- `studio.norikane.hosted-tier1-heartbeat.timer` runs every 2 minutes as a systemd user timer.
- Each heartbeat run checks the VPS loopback worker (`http://127.0.0.1:8787` by default) with bearer auth, so worker JSON error codes stay visible instead of being flattened by the public tunnel.
- Production chatbot preflight uses quick `GET /health?mode=quick` so an active Notion AI generation or CDP runtime inspection spike does not skip Tier1 before `/generate`.
- If the hosted Tier1 health probe times out or returns a retryable connection failure, Production still attempts `/generate`; fallback to Tier2 starts only after Tier1 generate exhausts its own repair/retry budget.
- A lightweight `POST /generate` smoke runs every 6 hours by default while healthy, and every 30 minutes after a failed smoke (`CHATBOT_HOSTED_TIER1_HEARTBEAT_GENERATE_RETRY_INTERVAL_MS`). Every smoke is a real Notion AI answer charged to the same allowance as customer replies: at ~126 smokes a day the monitor itself spent the monthly allowance on 2026-08-07 and 2026-09-26. A health-only tick between smokes does not close an incident the last smoke opened; the 2-minute timer still performs the cheap health check. The smoke always uses the fixed `hosted-tier1-heartbeat` conversation id, so it reuses its own Notion AI thread and never shares history with a customer consultation.
- Every conversation-scoped thread, including the heartbeat scope, is hidden from the workspace Chat list before Tier1 inference and verified hidden again after inference. A hide or verification failure fails Tier1 closed; it never falls back to the bootstrap or another customer's thread.
- One failed health/connection run moves state to `unhealthy`; transient hosted Notion AI `invalid-output` and `rate-limit` generate misses stay `suspect` until `CHATBOT_HOSTED_TIER1_HEARTBEAT_TRANSIENT_GENERATE_FAILURE_THRESHOLD` consecutive misses (default 2, so a sustained Notion-side outage escalates on the second generate sample instead of the third).
- Tier1 generate failure is not treated as a successful lower-tier fallback.
- On the first unhealthy transition, the script tries one repair sequence: `POST /ensure-chrome`, `systemctl --user restart hosted-notion-ai-worker.service`, then `systemctl --user restart hosted-worker-chrome.service`.
- Notion trust-rule, hosted Notion AI `invalid-output`, and hosted Notion AI `rate-limit` failures skip restart loops because service restarts do not fix model/extraction/quota responses.
- `notion_ai_thread_capacity` is its own incident class and escalates on the first sample rather than waiting for the transient threshold. It means the worker's Notion AI thread is out of storage; the worker rotates itself and only a *failed* rotation reaches this class. Restarting services does not help, so it skips the repair sequence too.
- A capacity-driven conversation-thread rotation is announced once as a `thread-rotated` notification, driven by `notionThread.rotation` in `/health`. Normal first-thread provisioning for a new consultation is not an incident and does not notify. The first observation never notifies, and a worker restart without a new rotation does not look like a change back to the bootstrap thread.
- Notifications are state-change only: `unhealthy` and `recovered`. `recovered` is sent only after an `unhealthy` notification was actually sent/dry-run for the active incident; rate-limited or unnotified unhealthy samples do not create recovered spam. Slack is primary when configured; Resend email remains fallback.
- Logs are JSONL and do not include bearer tokens, raw prompts, raw model output, cookies, or personal request bodies.
- When `/health` is ready but `/generate` fails, JSONL and Slack mark `incident_kind: health_ok_generate_failed` with phase, HTTP status, duration, sanitized worker error code/message preview, and repair action summary.
- Chatbot Slack/Vercel structured logs include sanitized retry attempt summaries: attempt number, outcome, reason, duration, timeout, HTTP status, and retryability only.
- Lifecycle fallback notifications add only `threadVisibility`, `threadHideVerification`, and a stable fallback reason. Raw thread URLs/ids, conversation ids, prompts, cookies, tokens, and customer text are excluded.
- `invalid-output` answers with HTTP 500, not 502. Cloudflare replaces an origin 502 with its own plain-text error page, so a 502 hides the worker error code, message, and retryable flag from Production and from every probe outside the VPS loopback. Diagnosing the 2026-08-06 outage required SSH for exactly that reason.
- Production honours the worker's `retryable: false` on 5xx instead of retrying every server error. Notion returning an empty inference stream (`bytes=0`, HTTP 200 `application/x-ndjson`) lasts minutes, so exhausting the retry budget only delays the Tier2 answer the customer receives.
- Timeout budgets are aligned so the worker does not abort Notion AI at 50s while the Production client still has budget: worker generate default 70s, client attempt default 75s, total Tier1 budget 90s, `/api/chatbot/message` maxDuration 120s.

Default VPS files:

- env: `~/.config/norikane/hosted-tier1-heartbeat.env`
- state: `~/.local/state/norikane_satoshi_hp/hosted-tier1-heartbeat-state.json`
- log: `~/.local/state/norikane_satoshi_hp/hosted-tier1-heartbeat.jsonl`
- worker service template: `scripts/chatbot/hosted-notion-ai-worker.service.template`
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
cp scripts/chatbot/hosted-notion-ai-worker.service.template ~/.config/systemd/user/hosted-notion-ai-worker.service
cp scripts/chatbot/studio.norikane.hosted-tier1-heartbeat.service.template ~/.config/systemd/user/studio.norikane.hosted-tier1-heartbeat.service
cp scripts/chatbot/studio.norikane.hosted-tier1-heartbeat.timer.template ~/.config/systemd/user/studio.norikane.hosted-tier1-heartbeat.timer
systemctl --user daemon-reload
systemctl --user enable --now hosted-notion-ai-worker.service
systemctl --user enable --now studio.norikane.hosted-tier1-heartbeat.timer
```

The worker exits with status `143` when systemd intentionally sends `SIGTERM` during a restart.
`SuccessExitStatus=143` keeps that expected shutdown out of the failed-unit state and warning logs;
it does not suppress real non-zero worker exits.

The live VPS worker repo is `/home/chatbot-worker/norikane_satoshi_HP`; do not switch its branch just to install the heartbeat because the worker service also runs from that directory. Reconcile from the approved master commit, then copy only the heartbeat service/timer templates or script when the web app code does not require a Vercel deploy.

Do not commit the env file.

## Spent Notion AI allowance

When Notion reports the AI allowance as spent (`notion_ai_usage_limit_reached`), the worker records the time in `~/.local/state/norikane_satoshi_hp/hosted-worker-notion-ai-quota.json` and exposes it as `runtime.notionAiQuotaExhaustedAt` on `/health`. For 45 minutes after the last such observation the worker refuses customer `/generate` requests at once with `rate-limit` instead of provisioning a Notion thread (~30 s) that cannot answer, and Production skips Tier1 on the health check. Only the heartbeat smoke (`hosted-tier1-heartbeat`) still reaches Notion; each failing smoke renews the window and the first successful answer clears it. Customers are answered by Tier 0 and Tier 2 meanwhile.

## VPS SSH access

`worker.norikane.studio` is the Cloudflare-fronted public worker hostname, not the SSH destination; SSH to it times out. Connect from Satoshi's Mac directly to the VPS IPv4 address (recorded in the Mac's shell history, not in this repo) as user `chatbot-worker` on port 22 with the identity file `~/.ssh/notion-worker-key.key`. No ProxyCommand, ProxyJump, or Cloudflare Access is involved.

```
ssh -i ~/.ssh/notion-worker-key.key -o BatchMode=yes -o ConnectTimeout=10 chatbot-worker@<VPS IPv4>
```

