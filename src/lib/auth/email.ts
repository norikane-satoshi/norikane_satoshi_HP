import { Resend } from "resend"

let cached: Resend | null = null

function getResend(): Resend {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error("RESEND_API_KEY is not set")
  if (!cached) cached = new Resend(apiKey)
  return cached
}

function getFrom(): string {
  const from = process.env.RESEND_FROM_EMAIL
  if (!from) throw new Error("RESEND_FROM_EMAIL is not set")
  return from
}

function getBaseUrl(): string {
  const url = process.env.AUTH_URL
  if (!url) throw new Error("AUTH_URL is not set")
  return url.replace(/\/+$/, "")
}

export async function sendVerificationEmail(args: {
  to: string
  token: string
}): Promise<void> {
  const link = `${getBaseUrl()}/api/auth/verify-email/${encodeURIComponent(args.token)}`
  const resend = getResend()
  const { error } = await resend.emails.send({
    from: getFrom(),
    to: args.to,
    subject: "メールアドレスの確認 / norikane.studio",
    text: [
      "norikane.studio へのご登録ありがとうございます。",
      "下記のリンクからメールアドレスの確認を完了してください（24時間有効）。",
      "",
      link,
      "",
      "このメールにお心当たりがない場合は破棄してください。",
    ].join("\n"),
  })
  if (error) throw new Error(`Resend send failed: ${error.message}`)
}

export async function sendPasswordResetEmail(args: {
  to: string
  token: string
}): Promise<void> {
  const link = `${getBaseUrl()}/api/auth/reset-password/${encodeURIComponent(args.token)}`
  const resend = getResend()
  const { error } = await resend.emails.send({
    from: getFrom(),
    to: args.to,
    subject: "パスワード再設定のご案内 / norikane.studio",
    text: [
      "パスワード再設定のリクエストを受け付けました。",
      "下記のリンクから新しいパスワードを設定してください（1時間有効）。",
      "",
      link,
      "",
      "このメールにお心当たりがない場合は破棄してください。",
    ].join("\n"),
  })
  if (error) throw new Error(`Resend send failed: ${error.message}`)
}
