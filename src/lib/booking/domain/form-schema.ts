import { z } from "zod"

export type BookingStep = "calendar" | "form" | "confirm" | "done"

export type BookingSlot = {
  start: string
  end: string
}

export type BookingDateRange = {
  startDate: string
  endDate: string
}

export type BookingDateSelection = {
  dates: string[]
}

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/

function toLocalDate(value: string): Date | null {
  if (!dateKeyPattern.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day, 0, 0, 0, 0)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

export function isValidBookingDateRange(range: BookingDateRange): boolean {
  const start = toLocalDate(range.startDate)
  const end = toLocalDate(range.endDate)
  return Boolean(start && end && start.getTime() <= end.getTime())
}

export function getBookingDateRangeDayCount(range: BookingDateRange): number {
  const start = toLocalDate(range.startDate)
  const end = toLocalDate(range.endDate)
  if (!start || !end || start.getTime() > end.getTime()) return 0
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
}

function formatDateKey(value: string): string {
  const date = toLocalDate(value)
  if (!date) return value
  return date.toLocaleDateString("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  })
}

export function normalizeBookingDateKeys(dates: string[]): string[] {
  return Array.from(new Set(dates.filter((date) => toLocalDate(date)))).sort()
}

export function bookingDateRangeToSelection(range: BookingDateRange): BookingDateSelection {
  if (!isValidBookingDateRange(range)) return { dates: [] }
  const start = toLocalDate(range.startDate)!
  const end = toLocalDate(range.endDate)!
  const dates: string[] = []
  for (let cursor = new Date(start); cursor.getTime() <= end.getTime(); cursor.setDate(cursor.getDate() + 1)) {
    dates.push(toDateKey(cursor))
  }
  return { dates }
}

export function isValidBookingDateSelection(selection: BookingDateSelection): boolean {
  return normalizeBookingDateKeys(selection.dates).length > 0
}

export function getBookingDateSelectionDayCount(selection: BookingDateSelection): number {
  return normalizeBookingDateKeys(selection.dates).length
}

function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function formatBookingDateSelection(selection: BookingDateSelection): string {
  const dates = normalizeBookingDateKeys(selection.dates)
  const dateLabel = dates.map((date) => formatDateKey(date)).join(", ")
  return dates.length > 0 ? `${dateLabel}、${dates.length}日間` : "未選択"
}

export function formatBookingDateRange(range: BookingDateRange): string {
  const dayCount = getBookingDateRangeDayCount(range)
  const dateLabel = range.startDate === range.endDate
    ? formatDateKey(range.startDate)
    : `${formatDateKey(range.startDate)}〜${formatDateKey(range.endDate)}`
  return dayCount > 0 ? `${dateLabel}、${dayCount}日間` : dateLabel
}

export const bookingFormSchema = z.object({
  projectTitle: z.string().trim().min(1, "案件名を入力してください").max(200, "200 字以内で入力してください"),
  dueDate: z.string(),
  companyName: z.string().trim().max(120, "120 字以内で入力してください"),
  contactName: z.string().trim().min(1, "氏名を入力してください").max(80, "80 字以内で入力してください"),
  sessionEmail: z.string().trim().max(254, "254 字以内で入力してください").refine(
    (value) => value === "" || z.string().email().safeParse(value).success,
    "認証済みメールを確認できません",
  ),
  phone: z.string().trim().max(32, "32 字以内で入力してください"),
  memo: z.string().trim().max(2000, "2000 字以内で入力してください"),
  agreed: z.boolean().refine((value) => value, {
    message: "規約への同意が必要です",
  }),
})

export type BookingFormData = z.infer<typeof bookingFormSchema>

export function createDefaultBookingFormData(sessionEmail: string): BookingFormData {
  return {
    projectTitle: "",
    dueDate: "",
    companyName: "",
    contactName: "",
    sessionEmail,
    phone: "",
    memo: "",
    agreed: false,
  }
}

export function mergeBookingFormData(
  current: BookingFormData,
  next: Partial<BookingFormData>,
  sessionEmail: string,
): BookingFormData {
  return {
    ...current,
    ...next,
    sessionEmail,
  }
}

export function getSlotDurationMinutes(slot: BookingSlot): number {
  const start = new Date(slot.start).getTime()
  const end = new Date(slot.end).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return Math.round((end - start) / 60000)
}

export function getTotalDurationMinutes(slots: BookingSlot[]): number {
  return slots.reduce((total, slot) => total + getSlotDurationMinutes(slot), 0)
}

export function formatDurationMinutes(minutes: number): string {
  if (minutes <= 0) return "0 時間"
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours === 0) return `${restMinutes} 分`
  if (restMinutes === 0) return `${hours} 時間`
  return `${hours} 時間 ${restMinutes} 分`
}
