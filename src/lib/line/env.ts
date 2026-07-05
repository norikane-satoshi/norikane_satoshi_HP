export function getLineLoginChannelId(): string {
  return process.env.LINE_LOGIN_CHANNEL_ID ?? process.env.AUTH_LINE_ID ?? ""
}

export function getLineLoginChannelSecret(): string {
  return process.env.LINE_LOGIN_CHANNEL_SECRET ?? process.env.AUTH_LINE_SECRET ?? ""
}

export function getLineWebhookChannelSecret(): string {
  return process.env.LINE_WEBHOOK_CHANNEL_SECRET ?? process.env.LINE_MESSAGING_CHANNEL_SECRET ?? ""
}

export function getLineMessagingChannelAccessToken(): string {
  return process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN ?? ""
}

export function getLineBookingLiffUrl(): string {
  return process.env.NEXT_PUBLIC_LINE_LIFF_URL ?? "https://liff.line.me/2010558388-b4OhcjYE"
}
