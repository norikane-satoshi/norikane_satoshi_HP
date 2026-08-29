import { z } from "zod"
import { getLocalizedCopy } from "@/i18n/copy"

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

export function formatBookingDateSelection(selection: BookingDateSelection, locale: "ja" | "en" = "ja"): string {
  const copy = getLocalizedCopy(locale, "Booking")
  const dates = normalizeBookingDateKeys(selection.dates)
  const dateLabel = dates.map((date) => formatDateKey(date)).join(", ")
  return dates.length > 0
    ? copy.dayCount.replace("{dates}", dateLabel).replace("{count}", String(dates.length))
    : copy.notSelectedValue
}

export function formatBookingDateRange(range: BookingDateRange): string {
  const dayCount = getBookingDateRangeDayCount(range)
  const dateLabel = range.startDate === range.endDate
    ? formatDateKey(range.startDate)
    : `${formatDateKey(range.startDate)}〜${formatDateKey(range.endDate)}`
  return dayCount > 0 ? `${dateLabel}、${dayCount}日間` : dateLabel
}

export function createBookingFormSchema(locale: "ja" | "en" = "ja") {
  const copy = getLocalizedCopy(locale, "Booking")
  const maxCharacters = (count: number) => copy.maxCharacters.replace("{count}", String(count))
  return z.object({
  projectTitle: z.string().trim().min(1, copy.projectRequired).max(200, maxCharacters(200)),
  dueDate: z.string(),
  companyName: z.string().trim().max(120, maxCharacters(120)),
  contactName: z.string().trim().min(1, copy.nameRequired).max(80, maxCharacters(80)),
  sessionEmail: z.string().trim().max(254, maxCharacters(254)).refine(
    (value) => value === "" || z.string().email().safeParse(value).success,
    copy.emailUnavailable,
  ),
  phone: z.string().trim().max(32, maxCharacters(32)),
  memo: z.string().trim().max(2000, maxCharacters(2000)),
  agreed: z.boolean().refine((value) => value, {
    message: copy.agreementRequired,
  }),
  })
}

export const bookingFormSchema = createBookingFormSchema()

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

export function formatDurationMinutes(minutes: number, locale: "ja" | "en" = "ja"): string {
  const copy = getLocalizedCopy(locale, "Booking")
  if (minutes <= 0) return copy.hours.replace("{value}", "0")
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours === 0) return copy.minutes.replace("{value}", String(restMinutes))
  if (restMinutes === 0) return copy.hours.replace("{value}", String(hours))
  return copy.durationHoursMinutes
    .replace("{hours}", String(hours))
    .replace("{minutes}", String(restMinutes))
}
