# Chatbot Slack Notifications

HP chatbot conversation notifications use Slack `chat.postMessage` with a bot token so the first message can return `ts` and later messages can reply to the same thread.

Required production env:

- `CHATBOT_SLACK_NOTIFICATIONS_ENABLED=true`
- `CHATBOT_SLACK_BOT_TOKEN`
- `CHATBOT_SLACK_CHANNEL_ID`
- `CHATBOT_SLACK_PRIVACY_MODE=mask-contact` unless the channel is confirmed as Satoshi-only operational Slack.

The app stores `slackChannelId`, `slackThreadTs`, and `slackNotifiedAt` on `ChatbotConversation`. Missing or failing Slack env never blocks chatbot responses, Booking Order creation, or email sending; it logs a warning and returns the original API response.

Problem events are posted into the same thread for Tier fallback, Tier 4 fallback, chatbot operation failure, Booking Order failure/completion, email send failure, unpublished note URL exposure, and edit/session reset anomalies.
