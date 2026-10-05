import { isCalendarDate } from "@/lib/chatbot/domain/deadline"

const weekdays = ["日", "月", "火", "水", "木", "金", "土"]

/** Display date keys independently of the host timezone. */
export function formatBookingDate(value: string): string {
  if (!isCalendarDate(value)) return value
  const date = new Date(`${value}T00:00:00Z`)
  return `${value.replaceAll("-", "/")}(${weekdays[date.getUTCDay()]})`
}

export function bookingDateKeyFromDisplay(value: string): string | undefined {
  if (isCalendarDate(value)) return value
  const match = /^(\d{4})\/(\d{2})\/(\d{2})\([日月火水木金土]\)$/u.exec(value)
  if (!match) return undefined
  const key = `${match[1]}-${match[2]}-${match[3]}`
  return isCalendarDate(key) && formatBookingDate(key) === value ? key : undefined
}

export function formatRequestedBookingDates(dates: ReadonlyArray<string>): string {
  return [...new Set(dates.filter(isCalendarDate))].sort().map(formatBookingDate).join("、")
}

export function formatBookingDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value
  if (!Number.isFinite(date.getTime())) return String(value)
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value
  return `${formatBookingDate(`${part("year")}-${part("month")}-${part("day")}`)} ${part("hour")}:${part("minute")}`
}

export function formatBookingSlot(start: string | Date, end: string | Date): string {
  if (typeof start === "string" && isCalendarDate(start)) return formatBookingDate(start)
  return `${formatBookingDateTime(start)} - ${formatBookingDateTime(end)}`
}
