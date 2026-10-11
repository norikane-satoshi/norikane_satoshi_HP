# Chatbot diagnostic requests

Automated checks against production (latency measurements, deploy verification scripts) must not
post to Slack. Send the header below with every request to `POST /api/chatbot/message` and
`POST /api/chatbot/create-booking-from-chat`. Message requests are handled normally with Slack
posts skipped. Booking requests return HTTP 503 (`booking_external_writes_disabled`) before creating
a customer, booking, Calendar/Notion hold, receipt, owner email or Slack notification. For message
requests, the audit event `slack_notification_completed`
records `slack-skipped-diagnostic`, which audit completeness and the live harnesses treat as that
boundary completing; any other Slack failure still fails them.

- Header: `x-chatbot-diagnostic`
- Value: hex HMAC-SHA256 of `chatbot-diagnostic-request` keyed with `CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN`
  (the same value the production app uses for the hosted worker; it is in `.env.local`).

`scripts/chatbot/verify-known-regressions-live.ts` and `scripts/chatbot/verify-endurance-live.ts`
send it automatically when that variable is set. For other scripts:

```sh
node -e 'const c=require("node:crypto");process.stdout.write(c.createHmac("sha256",process.env.CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN).update("chatbot-diagnostic-request").digest("hex"))'
```

The booking mutation endpoints also reject diagnostic requests on Production. Local and preview
booking writes are disabled by the server policy regardless of the header. See
[Booking verification isolation](booking-verification-isolation.md) for environment and test setup.

Production conversations without the header reach Slack as before: a customer's conversation and a manual test
typed in the browser widget (the widget never sends this header). Do not put the value in a browser,
a shared document or a log.
