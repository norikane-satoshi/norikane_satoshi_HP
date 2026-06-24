# Hosted Tier2 Heartbeat

`tier-2-hosted-chrome-notion-ai` is monitored from the VPS, not from Satoshi's Mac or `localhost:41238`.

Runtime shape:

- `studio.norikane.hosted-tier2-heartbeat.timer` runs every 2 minutes as a systemd user timer.
- Each run checks `GET /health` with bearer auth.
- A lightweight `POST /generate` smoke runs every 2 minutes by default.
- One failed run moves state to `unhealthy`; Tier2 generate failure is not treated as a successful lower-tier fallback.
- On the first unhealthy transition, the script tries one repair sequence: `POST /ensure-chrome`, `systemctl --user restart hosted-notion-ai-worker.service`, then `systemctl --user restart hosted-worker-chrome.service`.
- Notion trust-rule failures alert immediately but skip restart loops because service restarts do not fix policy denial.
- Notifications are state-change only: `unhealthy` and `recovered`. Slack is primary when configured; Resend email remains fallback. Same-state alert spam is rate-limited.
- Logs are JSONL and do not include bearer tokens, raw prompts, raw model output, cookies, or personal request bodies.
- When `/health` is ready but `/generate` fails, JSONL and Slack mark `incident_kind: health_ok_generate_failed` with phase, HTTP status, duration, sanitized worker error code/message preview, and repair action summary.

Default VPS files:

- env: `~/.config/norikane/hosted-tier2-heartbeat.env`
- state: `~/.local/state/norikane_satoshi_hp/hosted-tier2-heartbeat-state.json`
- log: `~/.local/state/norikane_satoshi_hp/hosted-tier2-heartbeat.jsonl`
- service template: `scripts/chatbot/studio.norikane.hosted-tier2-heartbeat.service.template`
- timer template: `scripts/chatbot/studio.norikane.hosted-tier2-heartbeat.timer.template`

Required env keys stay on the VPS only:

- `CHATBOT_HOSTED_NOTION_AI_WORKER_URL`
- `CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN`
- `SLACK_BOT_TOKEN` plus `CHATBOT_HOSTED_TIER2_HEARTBEAT_SLACK_CHANNEL`, or `CHATBOT_HOSTED_TIER2_HEARTBEAT_SLACK_WEBHOOK_URL`

Optional env keys:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `CHATBOT_HOSTED_TIER2_HEARTBEAT_NOTIFY_EMAIL`
- `CHATBOT_HOSTED_TIER2_HEARTBEAT_GENERATE_INTERVAL_MS`
- `CHATBOT_HOSTED_TIER2_HEARTBEAT_GENERATE_TIMEOUT_MS`
- `CHATBOT_HOSTED_TIER2_HEARTBEAT_FAILURE_THRESHOLD`
- `CHATBOT_HOSTED_TIER2_HEARTBEAT_NOTIFICATION_COOLDOWN_MS`
- `CHATBOT_HOSTED_TIER2_HEARTBEAT_DRY_RUN_NOTIFY`

Install on the VPS after copying the repo branch:

```bash
mkdir -p ~/.config/systemd/user ~/.config/norikane
cp scripts/chatbot/studio.norikane.hosted-tier2-heartbeat.service.template ~/.config/systemd/user/studio.norikane.hosted-tier2-heartbeat.service
cp scripts/chatbot/studio.norikane.hosted-tier2-heartbeat.timer.template ~/.config/systemd/user/studio.norikane.hosted-tier2-heartbeat.timer
systemctl --user daemon-reload
systemctl --user enable --now studio.norikane.hosted-tier2-heartbeat.timer
```

The live VPS worker repo is `/home/chatbot-worker/norikane_satoshi_HP`; do not switch its branch just to install the heartbeat because the worker service also runs from that directory. Reconcile from the approved master commit, then copy only the heartbeat service/timer templates or script when the web app code does not require a Vercel deploy.

Do not commit the env file.
