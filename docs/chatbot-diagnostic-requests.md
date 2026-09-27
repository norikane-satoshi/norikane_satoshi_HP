# Chatbot diagnostic requests

Automated checks against production (latency measurements, deploy verification scripts) must not
post to Slack. Send the header below with every `POST /api/chatbot/message`; the conversation is
handled normally but its Slack notifications (reply and failure notices) are skipped, and the audit
event `slack_notification_completed` records `slack-skipped`.

- Header: `x-chatbot-diagnostic`
- Value: hex HMAC-SHA256 of `chatbot-diagnostic-request` keyed with `CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN`
  (the same value the production app uses for the hosted worker; it is in `.env.local`).

```sh
node -e 'const c=require("node:crypto");process.stdout.write(c.createHmac("sha256",process.env.CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN).update("chatbot-diagnostic-request").digest("hex"))'
```

Anything else reaches Slack as before: a customer's conversation, and a manual test typed in the
browser widget (the widget never sends this header). Do not put the value in a browser, a shared
document or a log.
