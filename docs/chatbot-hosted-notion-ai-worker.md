# Hosted Notion AI Worker

HP AI 相談窓口の `tier-2-hosted-chrome-notion-ai` 用 worker。Production deploy はまだ行わない。merge order は PR #114 -> PR #115 -> hosted worker PR の順で確認し、`master` merge は Satoshi の明示指示後のみ行う。

## Local API

- `GET /health`: Bearer auth 後、Chrome CDP、Notion target、login redirect、preferred model、queue state を返す。
- `POST /generate`: Bearer auth 後、既存 `tier-1-chrome-notion-ai` の Notion AI 実行経路を使い、response tier を `tier-2-hosted-chrome-notion-ai` に正規化する。
- `POST /ensure-chrome`: CDP connection refused / target missing / manual login required / model unavailable / target URL mismatch を分類し、ログイン redirect は自動ログインしない。

## Scripts

```bash
pnpm chatbot:hosted-worker:start
pnpm chatbot:hosted-worker:ensure-chrome
pnpm chatbot:hosted-worker:smoke -- --base-url http://127.0.0.1:8787
pnpm chatbot:hosted-worker:smoke -- --dry-run
```

Required env names:

- `CHATBOT_HOSTED_WORKER_TOKEN`
- `CHATBOT_HOSTED_WORKER_PORT`
- `CHATBOT_HOSTED_WORKER_HOST`
- `CHATBOT_HOSTED_WORKER_CDP_BASE_URL`
- `CHATBOT_HOSTED_WORKER_NOTION_THREAD_URL`
- `CHATBOT_HOSTED_WORKER_NOTION_MODEL`
- `CHATBOT_HOSTED_WORKER_TIMEOUT_MS`
- `CHATBOT_HOSTED_WORKER_GENERATE_TIMEOUT_MS`
- `CHATBOT_HOSTED_WORKER_CHROME_PROFILE_DIR`
- `CHATBOT_HOSTED_WORKER_CHROME_COMMAND`
- `CHATBOT_HOSTED_WORKER_CHROME_APP`
- `CHATBOT_HOSTED_WORKER_CHROME_WAIT_MS`

HP backend env names:

- `CHATBOT_HOSTED_NOTION_AI_WORKER_URL`
- `CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN`
- `CHATBOT_HOSTED_NOTION_AI_TIMEOUT_MS`
- `CHATBOT_HOSTED_NOTION_AI_HEALTH_TIMEOUT_MS`
- `CHATBOT_HOSTED_NOTION_AI_ENABLED`

Secret values are stored only in the VM secret store / Vercel env / Bitwarden, not in this repo, PR text, logs, Notion comments, or snapshots.

## Security

- Chrome CDP must stay bound to `127.0.0.1:9223`.
- Do not expose CDP through firewall, reverse proxy, SSH tunnel, or public interface.
- Worker logs and diagnostics are limited to tier, latency, status, error code, target found, model availability, queue length, and byte counts.
- Bearer token, Notion cookie/session, full request body, email address, and user-provided personal information must not be logged.
- `GET /health`, `POST /generate`, and `POST /ensure-chrome` all require `Authorization: Bearer ${CHATBOT_HOSTED_WORKER_TOKEN}`.

## Runtime

The MVP runtime is single-flight: one `/generate` call runs at a time. Health includes:

- `queue.inFlight`
- `queue.queueLength`
- `queue.lastSuccessAt`
- `queue.lastErrorCode`
- `queue.lastLatencyMs`

Timeouts fail inside the worker and are returned as HTTP 504. HP backend must then continue to Tier 3 fallback.

## Predeploy Checklist

Do not execute these steps until Satoshi explicitly approves Production deploy / master merge.

- [ ] Confirm PR #114 is merged first: `feat/hosted-worker-tier3-rename`.
- [ ] Confirm PR #115 is merged second: `feat/hosted-worker-tier2-client`.
- [ ] Confirm hosted worker PR is merged third, only after #114 and #115.
- [ ] Prepare VM SSH key and restrict login to the dedicated deployment user.
- [ ] Create a dedicated VM user for the worker.
- [ ] Configure VM firewall so public access reaches only the intended HTTPS worker endpoint; CDP `9223` remains loopback-only.
- [ ] Create a dedicated Chrome profile directory for Hosted worker Notion AI.
- [ ] Start Chrome with `--remote-debugging-address=127.0.0.1 --remote-debugging-port=9223`.
- [ ] Manually log in to Notion in the dedicated Chrome profile.
- [ ] Open the configured Notion AI thread and confirm `/ensure-chrome` returns `ready`.
- [ ] Configure worker systemd unit, but do not `enable` or `start` it before approval.
- [ ] Configure worker URL and token in the VM secret store.
- [ ] Configure Vercel Production env names for the HP backend, without exposing values in logs or docs.
- [ ] Run direct worker smoke: `/health`, `/generate`, invalid token 401, and secret non-exposure.
- [ ] Run HP backend fallback smoke with Tier 1 unavailable and Tier 2 healthy.
- [ ] Run HP backend fallback smoke with Tier 2 disabled/unhealthy and Tier 3 reachable.
- [ ] Run final `pnpm typecheck`, `pnpm lint`, and `pnpm test`.
- [ ] Merge to `master` only after Satoshi explicitly approves Production deploy / master merge.
