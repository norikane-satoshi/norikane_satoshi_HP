import { bookingDetailLabels, displayBookingDetails, type BookingDetail, type BookingDetailLabel } from "@/lib/chatbot/domain/booking-details"
import { formatBookingDate, formatBookingDateTime, formatBookingSlot, formatRequestedBookingDates } from "@/lib/booking/domain/booking-display"
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
  requestedDates?: string[]
  requestedDateRange?: BookingDateRange
  bookingGroupId?: string
  workScopes: string[]
  otherWorkDetail?: string
  estimatedDuration?: string
  memo?: string
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
  requestedDates?: string[]
  requestedDateRange?: BookingDateRange
  submittedAt?: string | Date
}

const SITE_URL = "https://norikane.studio"
const SHOP_NAME = "のりかね映像設計室"
const COMPANY_NAME = "合同会社のりかね映像設計室"
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
  return formatBookingDateTime(value)
}

function formatSchedule(start: string | Date, end: string | Date): string {
  return formatBookingSlot(start, end)
}

function formatRequestedDateRange(range: BookingDateRange): string {
  if (range.startDate === range.endDate) return formatBookingDate(range.startDate)
  return `${formatBookingDate(range.startDate)}〜${formatBookingDate(range.endDate)}`
}

function formatRequestedDates(dates: string[]): string {
  return formatRequestedBookingDates(dates) || "候補日未選択"
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
  return ["", COMPANY_NAME, SITE_URL]
}

function getChatbotBookingOwnerEmail(): string {
  return process.env.CHATBOT_BOOKING_OWNER_EMAIL?.trim() || DEFAULT_CHATBOT_BOOKING_OWNER_EMAIL
}

function formatOptional(value: string | undefined): string {
  return value?.trim() || "-"
}

function formatSelectedSlots(
  slots: ChatbotBookingOwnerNotificationArgs["selectedSlots"],
  requestedDates?: string[],
  requestedDateRange?: BookingDateRange,
): string {
  if (slots.length === 0) {
    if (requestedDates?.length) return formatRequestedDates(requestedDates)
    return requestedDateRange ? formatRequestedDateRange(requestedDateRange) : "未定（日程は則兼と相談）"
  }
  return slots.map((slot) => formatSchedule(slot.start, slot.end)).join("\n")
}

function getBookingEmailSlots(args: BookingEmailArgs): BookingScheduleSlot[] {
  if (args.selectedSlots?.length) return args.selectedSlots
  if (args.start && args.end) return [{ start: args.start, end: args.end }]
  return []
}

function getBookingEmailSubjectSchedule(slots: BookingScheduleSlot[], requestedDates?: string[], requestedDateRange?: BookingDateRange): string {
  if (slots.length === 0) {
    if (requestedDates?.length) return formatRequestedDates(requestedDates)
    return requestedDateRange ? formatRequestedDateRange(requestedDateRange) : "未定（日程は則兼と相談）"
  }
  if (slots.length === 1) return formatSchedule(slots[0].start, slots[0].end)
  return `${slots.length}件の仮キープ候補`
}

function bookingConditionLines(schedule: string, memo = ""): string[] {
  const values = new Map<string, string>()
  const notes: string[] = []
  for (const line of memo.split("\n")) {
    const match = /^\s*([^:：]+)[:：]\s*(.*)$/u.exec(line)
    if (match && (bookingDetailLabels.includes(match[1] as BookingDetailLabel) || match[1] === "都合の悪い日")) {
      values.set(match[1], match[2])
    } else if (line.trim() && !/^\s*(?:希望日|作業日数|立ち会い日数|基本工程目安|工程目安|工程)(?:[:：]|（)/u.test(line)) {
      notes.push(line.replace(/^\s*(?:補足|備考)[:：]\s*/u, ""))
    }
  }
  const details: BookingDetail[] = bookingDetailLabels.map((label) => ({ label, value: values.get(label) ?? "未確認" }))
  return [
    `希望日: ${schedule}`,
    `都合の悪い日: ${values.get("都合の悪い日")?.trim() || "未確認"}`,
    ...displayBookingDetails(details).map(({ label, value }) => `${label}: ${value}`),
    `補足: ${notes.join("\n").trim() || "未確認"}`,
  ]
}

export async function sendChatbotBookingOwnerNotification(
  args: ChatbotBookingOwnerNotificationArgs,
): Promise<BookingEmailResult> {
  const to = getChatbotBookingOwnerEmail()
  const schedule = formatSelectedSlots(args.selectedSlots, args.requestedDates, args.requestedDateRange)
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
      `氏名: ${args.contactName}`,
      `メール: ${args.contactEmail}`,
      `会社名: ${formatOptional(args.companyName)}`,
      ...bookingConditionLines(schedule, args.memo),
      `予約番号: ${args.bookingGroupId}`,
      `送信日時: ${formatDateTime(submittedAt)}`,
      "経由: HPチャットボット Booking Order",
      ...signatureLines(),
    ],
  })
}

export function buildBookingConfirmedEmail(args: BookingEmailArgs) {
  const slots = getBookingEmailSlots(args)
  const schedule = formatSelectedSlots(slots, args.requestedDates, args.requestedDateRange)
  const hasRequestedDates = slots.length > 0 || Boolean(args.requestedDates?.length || args.requestedDateRange)
  const receiptLabel = hasRequestedDates ? "仮キープ受付" : "ご相談受付"
  const subject = `【${receiptLabel}】${args.projectTitle} のご相談を受け付けました（${getBookingEmailSubjectSchedule(slots, args.requestedDates, args.requestedDateRange)}）`
  const scheduleNote = slots.length > 0
    ? "選択された日程は実施日ではなく、仮キープ候補としてお預かりしています。"
    : args.requestedDates?.length || args.requestedDateRange
      ? "選択された日程は確定予約ではなく、希望日としてお預かりしています。"
      : "候補日は未選択のため、日程は後ほど相談させてください。"
  const bookingGroupLine = args.bookingGroupId ? [`予約番号: ${args.bookingGroupId}`] : []
  const lines = [
    `このたびはご相談いただきありがとうございます。${receiptLabel}として内容をお預かりしました。`,
    scheduleNote,
    "内容を確認のうえ、後ほど則兼本人から直接ご連絡します。",
    "",
    `案件名: ${args.projectTitle}`,
    ...bookingGroupLine,
    "内容に誤りがあれば、このメールへの返信でお知らせください",
    ...bookingConditionLines(schedule, args.memo),
    ...(formatWork(args) ? [`作業内容:\n${formatBookingWork(args)}`] : []),
    "",
    "このメールは受付内容の控えです。",
    ...signatureLines(),
  ]
  return { subject, lines, text: lines.join("\n"), html: paragraphsToHtml(lines) }
}

export async function sendBookingConfirmedEmail(args: BookingEmailArgs): Promise<BookingEmailResult> {
  return sendBookingEmail({
    tag: "tentative_hold",
    to: args.to,
    replyTo: getChatbotBookingOwnerEmail(),
    ...buildBookingConfirmedEmail(args),
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
