# Chatbot diagnostic requests

Automated checks against production (latency measurements, deploy verification scripts) must not
post to Slack. Send the header below with every request to `POST /api/chatbot/message` and
`POST /api/chatbot/create-booking-from-chat`; the request is handled normally but its Slack posts
(reply, failure notice, booking notice) are skipped. The audit event `slack_notification_completed`
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

Only Slack is skipped. A diagnostic booking still creates its booking, owner email and work-database
hold like any other, so a check that submits a booking must clean those up itself.

Anything without the header reaches Slack as before: a customer's conversation, and a manual test
typed in the browser widget (the widget never sends this header). Do not put the value in a browser,
a shared document or a log.
