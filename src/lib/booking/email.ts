import { Resend } from "resend"

let cached: Resend | null = null

export type BookingEmailResult = { skipped: true } | { skipped: false; id: string | null }

export type BookingEmailArgs = {
  to: string
  projectTitle: string
  start: string | Date
  end: string | Date
  workScopes: string[]
  otherWorkDetail?: string
  estimatedDuration?: string
}

export type BookingOverwriteNoticeEmailArgs = BookingEmailArgs & {
  deadline: string | Date
}

const SITE_URL = "https://norikane.studio"
const SHOP_NAME = "のりかね映像設計室"
const DEFAULT_FROM_EMAIL = "noreply@norikane.studio"

export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  if (!cached) cached = new Resend(apiKey)
  return cached
}

function getFrom(): string {
  const email = process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM_EMAIL
  return `${SHOP_NAME} <${email}>`
}

function formatDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function formatSchedule(start: string | Date, end: string | Date): string {
  return `${formatDateTime(start)} - ${formatDateTime(end)}`
}

function formatWork(args: Pick<BookingEmailArgs, "workScopes" | "otherWorkDetail" | "estimatedDuration">): string {
  const scopes = args.workScopes.join(" / ")
  const detail = args.otherWorkDetail?.trim()
  return [scopes, detail].filter(Boolean).join("\n")
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function paragraphsToHtml(lines: string[]): string {
  return lines
    .map((line) => {
      if (line === "") return "<br>"
      return `<p>${escapeHtml(line).replaceAll("\n", "<br>")}</p>`
    })
    .join("")
}

async function sendBookingEmail(args: {
  tag: "confirmed" | "tentative" | "overwrite" | "expired"
  to: string
  subject: string
  lines: string[]
}): Promise<BookingEmailResult> {
  const resend = getResendClient()
  if (!resend) {
    console.warn(`[email skipped] tag=${args.tag} to=${args.to}`)
    return { skipped: true }
  }

  const { data, error } = await resend.emails.send({
    from: getFrom(),
    to: args.to,
    subject: args.subject,
    text: args.lines.join("\n"),
    html: paragraphsToHtml(args.lines),
  })
  if (error) throw new Error(`Resend send failed: ${error.message}`)
  return { skipped: false, id: data?.id ?? null }
}

function signatureLines(): string[] {
  return ["", SHOP_NAME, SITE_URL]
}

export async function sendBookingConfirmedEmail(args: BookingEmailArgs): Promise<BookingEmailResult> {
  const schedule = formatSchedule(args.start, args.end)
  const subject = `【予約確定】${args.projectTitle} のご予約を確定しました（${schedule}）`
  return sendBookingEmail({
    tag: "confirmed",
    to: args.to,
    subject,
    lines: [
      "このたびはご予約いただきありがとうございます。本予約として確定しました。",
      "",
      `案件名: ${args.projectTitle}`,
      `日時: ${schedule}`,
      `作業内容:\n${formatWork(args)}`,
      "",
      "変更やキャンセルのご相談がある場合は、このメールへの返信でお知らせください。",
      ...signatureLines(),
    ],
  })
}

export async function sendBookingTentativeEmail(args: BookingEmailArgs): Promise<BookingEmailResult> {
  const schedule = formatSchedule(args.start, args.end)
  const subject = `【仮キープ受付】${args.projectTitle} の候補日を仮押さえしました（${schedule}）`
  return sendBookingEmail({
    tag: "tentative",
    to: args.to,
    subject,
    lines: [
      "候補日の仮キープを受け付けました。",
      "",
      `案件名: ${args.projectTitle}`,
      `日時: ${schedule}`,
      `作業内容:\n${formatWork(args)}`,
      "",
      "本予約へ切り替える場合は、HP 予約ページから当該枠を再操作してください。",
      "同じ枠に他のお客様から本予約申込が入った場合は通知メールをお送りします。その場合は、通知から3日以内のご対応が必要です。",
      ...signatureLines(),
    ],
  })
}

export async function sendBookingOverwriteNoticeEmail(
  args: BookingOverwriteNoticeEmailArgs,
): Promise<BookingEmailResult> {
  const schedule = formatSchedule(args.start, args.end)
  const deadline = formatDateTime(args.deadline)
  const subject = `【ご確認ください】仮キープの枠に他のお客様から本予約申込が入りました（${schedule}）`
  return sendBookingEmail({
    tag: "overwrite",
    to: args.to,
    subject,
    lines: [
      "仮キープ中の枠に、他のお客様から本予約申込が入りました。",
      "",
      `案件名: ${args.projectTitle}`,
      `日時: ${schedule}`,
      `対応期限: ${deadline}`,
      "",
      "期限までに、本予約への切り替えまたは別日への変更をご対応ください。",
      "期限までにご応答がない場合は、後から本予約申込をされたお客様の予約で上書きされます。",
      ...signatureLines(),
    ],
  })
}

export async function sendBookingTentativeExpiredEmail(args: BookingEmailArgs): Promise<BookingEmailResult> {
  const schedule = formatSchedule(args.start, args.end)
  const subject = `【ご連絡】仮キープが期限切れにより取り消されました（${schedule}）`
  return sendBookingEmail({
    tag: "expired",
    to: args.to,
    subject,
    lines: [
      "仮キープのご案内から3日以内にご応答がなかったため、対象の仮キープを取り消しました。",
      "",
      `案件名: ${args.projectTitle}`,
      `日時: ${schedule}`,
      "",
      "あらためてご予約をご希望の場合は、HP 予約ページから再度お申し込みください。",
      ...signatureLines(),
    ],
  })
}
