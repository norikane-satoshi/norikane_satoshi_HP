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

export type BookingTimeChangedEmailArgs = {
  to: string
  projectTitle: string
  oldStart: string | Date
  oldEnd: string | Date
  newStart: string | Date
  newEnd: string | Date
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
  tag: "confirmed" | "time_changed"
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

export async function sendBookingTimeChangedEmail(
  args: BookingTimeChangedEmailArgs,
): Promise<BookingEmailResult> {
  const subject = `【予約時間変更】${args.projectTitle} のご予約時間を変更しました`
  return sendBookingEmail({
    tag: "time_changed",
    to: args.to,
    subject,
    lines: [
      "ご予約いただいている案件の予約時間を変更しました。",
      "",
      `案件名: ${args.projectTitle}`,
      `変更前: ${formatSchedule(args.oldStart, args.oldEnd)}`,
      `変更後: ${formatSchedule(args.newStart, args.newEnd)}`,
      "",
      "ご都合が合わない場合は、このメールへの返信でお知らせください。",
      ...signatureLines(),
    ],
  })
}
