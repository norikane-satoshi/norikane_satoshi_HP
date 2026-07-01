import { Resend } from "resend"

let cached: Resend | null = null

export type BookingEmailResult = { skipped: true } | { skipped: false; id: string | null }

type BookingScheduleSlot = { start: string | Date; end: string | Date }
type BookingDateRange = { startDate: string; endDate: string }

export type BookingEmailArgs = {
  to: string
  projectTitle: string
  start?: string | Date
  end?: string | Date
  selectedSlots?: BookingScheduleSlot[]
  requestedDateRange?: BookingDateRange
  bookingGroupId?: string
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

export type ChatbotBookingOwnerNotificationArgs = {
  bookingGroupId: string
  projectTitle: string
  contactName: string
  contactEmail: string
  companyName?: string
  memo?: string
  selectedSlots: BookingScheduleSlot[]
  requestedDateRange?: BookingDateRange
  submittedAt?: string | Date
}

const SITE_URL = "https://norikane.studio"
const SHOP_NAME = "のりかね映像設計室"
const DEFAULT_FROM_EMAIL = "noreply@norikane.studio"
export const DEFAULT_CHATBOT_BOOKING_OWNER_EMAIL = "norikane.satoshi@gmail.com"

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

function dateFromDateKey(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day, 0, 0, 0, 0)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

function formatDateOnly(value: string): string {
  const date = dateFromDateKey(value)
  if (!date) return value
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(date)
}

function formatRequestedDateRange(range: BookingDateRange): string {
  if (range.startDate === range.endDate) return formatDateOnly(range.startDate)
  const start = dateFromDateKey(range.startDate)
  const end = dateFromDateKey(range.endDate)
  const dayCount = start && end
    ? Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
    : 0
  const countLabel = dayCount > 0 ? `、${dayCount}日間` : ""
  return `${formatDateOnly(range.startDate)}〜${formatDateOnly(range.endDate)}${countLabel}`
}

function formatWork(args: Pick<BookingEmailArgs, "workScopes" | "otherWorkDetail" | "estimatedDuration">): string {
  const scopes = args.workScopes.join(" / ")
  const detail = args.otherWorkDetail?.trim()
  return [scopes, detail].filter(Boolean).join("\n")
}

function formatBookingWork(args: Pick<BookingEmailArgs, "workScopes" | "otherWorkDetail" | "estimatedDuration">): string {
  return formatWork(args) || "-"
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
  tag: "tentative_hold" | "time_changed" | "chatbot_owner"
  to: string
  replyTo?: string
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
    replyTo: args.replyTo,
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

function getChatbotBookingOwnerEmail(): string {
  return process.env.CHATBOT_BOOKING_OWNER_EMAIL?.trim() || DEFAULT_CHATBOT_BOOKING_OWNER_EMAIL
}

function formatOptional(value: string | undefined): string {
  return value?.trim() || "-"
}

function formatSelectedSlots(
  slots: ChatbotBookingOwnerNotificationArgs["selectedSlots"],
  requestedDateRange?: BookingDateRange,
): string {
  if (slots.length === 0) return requestedDateRange ? formatRequestedDateRange(requestedDateRange) : "候補日未選択"
  return slots.map((slot) => formatSchedule(slot.start, slot.end)).join("\n")
}

function getBookingEmailSlots(args: BookingEmailArgs): BookingScheduleSlot[] {
  if (args.selectedSlots?.length) return args.selectedSlots
  if (args.start && args.end) return [{ start: args.start, end: args.end }]
  return []
}

function getBookingEmailSubjectSchedule(slots: BookingScheduleSlot[], requestedDateRange?: BookingDateRange): string {
  if (slots.length === 0) return requestedDateRange ? formatRequestedDateRange(requestedDateRange) : "候補日未選択"
  if (slots.length === 1) return formatSchedule(slots[0].start, slots[0].end)
  return `${slots.length}件の仮キープ候補`
}

export async function sendChatbotBookingOwnerNotification(
  args: ChatbotBookingOwnerNotificationArgs,
): Promise<BookingEmailResult> {
  const to = getChatbotBookingOwnerEmail()
  const schedule = formatSelectedSlots(args.selectedSlots, args.requestedDateRange)
  const submittedAt = args.submittedAt ?? new Date()

  return sendBookingEmail({
    tag: "chatbot_owner",
    to,
    replyTo: args.contactEmail,
    subject: `【チャットボット予約通知】${args.projectTitle}`,
    lines: [
      "HPチャットボット経由で Booking Order が送信されました。",
      "",
      `案件名: ${args.projectTitle}`,
      `担当者氏名: ${args.contactName}`,
      `メールアドレス: ${args.contactEmail}`,
      `会社名: ${formatOptional(args.companyName)}`,
      `候補日: ${schedule}`,
      `補足ノート: ${formatOptional(args.memo)}`,
      `予約番号: ${args.bookingGroupId}`,
      `送信日時: ${formatDateTime(submittedAt)}`,
      "経由: HPチャットボット Booking Order",
      ...signatureLines(),
    ],
  })
}

export async function sendBookingConfirmedEmail(args: BookingEmailArgs): Promise<BookingEmailResult> {
  const slots = getBookingEmailSlots(args)
  const schedule = formatSelectedSlots(slots, args.requestedDateRange)
  const subject = `【仮キープ受付】${args.projectTitle} のご相談を受け付けました（${getBookingEmailSubjectSchedule(slots, args.requestedDateRange)}）`
  const scheduleLine = slots.length > 0
    ? `仮キープ候補日:\n${schedule}`
    : args.requestedDateRange
      ? `相談希望日: ${schedule}`
      : "候補日: 候補日未選択（候補日未選択の相談として受け付けました）"
  const scheduleNote = slots.length > 0
    ? "選択された日程は実施日ではなく、仮キープ候補としてお預かりしています。"
    : args.requestedDateRange
      ? "選択された日程は確定予約ではなく、相談希望日としてお預かりしています。"
      : "候補日は未選択のため、日程は後ほど相談させてください。"
  const bookingGroupLine = args.bookingGroupId ? [`予約番号: ${args.bookingGroupId}`] : []
  return sendBookingEmail({
    tag: "tentative_hold",
    to: args.to,
    subject,
    lines: [
      "このたびはご相談いただきありがとうございます。仮キープ受付として内容をお預かりしました。",
      scheduleNote,
      "内容を確認のうえ、後ほど則兼本人から直接ご連絡します。",
      "",
      `案件名: ${args.projectTitle}`,
      ...bookingGroupLine,
      scheduleLine,
      `作業内容:\n${formatBookingWork(args)}`,
      "",
      "このメールは受付内容の控えです。変更や追加のご相談がある場合は、このメールへの返信でお知らせください。",
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
