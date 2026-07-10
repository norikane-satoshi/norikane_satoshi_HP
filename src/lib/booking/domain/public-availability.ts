export const PUBLIC_AVAILABILITY_ROUTE = "/availability-calendar"

export type PublicAvailabilityBusySlot = {
  start: string
  end: string
}

export type PublicAvailabilityDayStatus = "available" | "busy" | "tentative"

export type PublicAvailabilityDay = {
  dateKey: string
  day: number
  inMonth: boolean
  isTodayOrPast: boolean
  isBusy: boolean
  isTentative: boolean
  status: PublicAvailabilityDayStatus
}

export type PublicAvailabilityMonth = {
  month: string
  monthLabel: string
  prevMonth: string
  nextMonth: string
  range: {
    start: string
    end: string
    timeMin: string
    timeMax: string
  }
  days: PublicAvailabilityDay[]
  busyDateKeys: string[]
  tentativeDateKeys: string[]
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const JST_TIME_ZONE = "Asia/Tokyo"

const tokyoDatePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: JST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

function toDateKey(year: number, month: number, day: number): string {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-")
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  const [year = "0", month = "0", day = "0"] = dateKey.split("-")
  return { year: Number(year), month: Number(month), day: Number(day) }
}

function dateKeyFromUtcDate(date: Date): string {
  return toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function addDays(dateKey: string, days: number): string {
  const { year, month, day } = parseDateKey(dateKey)
  return dateKeyFromUtcDate(new Date(Date.UTC(year, month - 1, day + days)))
}

function addMonths(month: string, months: number): string {
  const [year = "0", monthNumber = "1"] = month.split("-")
  const date = new Date(Date.UTC(Number(year), Number(monthNumber) - 1 + months, 1))
  return toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, 1).slice(0, 7)
}

function daysInMonth(month: string): number {
  const [year = "0", monthNumber = "1"] = month.split("-")
  return new Date(Date.UTC(Number(year), Number(monthNumber), 0)).getUTCDate()
}

function dayOfWeek(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function toTokyoDateKey(date = new Date()): string {
  const parts = tokyoDatePartsFormatter.formatToParts(date)
  const year = parts.find((part) => part.type === "year")?.value
  const month = parts.find((part) => part.type === "month")?.value
  const day = parts.find((part) => part.type === "day")?.value
  if (!year || !month || !day) return dateKeyFromUtcDate(date)
  return `${year}-${month}-${day}`
}

function normalizeMonth(month: string | null | undefined, now: Date): string {
  if (month && MONTH_PATTERN.test(month)) return month
  return toTokyoDateKey(now).slice(0, 7)
}

function hasTimePart(value: string): boolean {
  return /T\d{2}:\d{2}/.test(value)
}

function isMidnightDateTime(value: string): boolean {
  return /T00:00(?::00)?(?:\.000)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value)
}

function isFullDayBusySlot(slot: PublicAvailabilityBusySlot): boolean {
  if (!hasTimePart(slot.start) || !hasTimePart(slot.end)) return true

  const start = new Date(slot.start)
  const end = new Date(slot.end)
  const durationMs = end.getTime() - start.getTime()

  return isMidnightDateTime(slot.start) && isMidnightDateTime(slot.end) && durationMs >= 24 * 60 * 60 * 1000
}

function isTimedBusySlot(slot: PublicAvailabilityBusySlot): boolean {
  const start = new Date(slot.start)
  const end = new Date(slot.end)
  return hasTimePart(slot.start) && hasTimePart(slot.end) && !isFullDayBusySlot(slot) && end.getTime() > start.getTime()
}

function dateKeysForTimedSlot(slot: PublicAvailabilityBusySlot): string[] {
  if (!isTimedBusySlot(slot)) return []
  const start = new Date(slot.start)
  const end = new Date(new Date(slot.end).getTime() - 1)
  const startKey = toTokyoDateKey(start)
  const endKey = toTokyoDateKey(end)
  const keys: string[] = []
  for (let cursor = startKey; cursor <= endKey; cursor = addDays(cursor, 1)) {
    keys.push(cursor)
  }
  return keys
}

function dateKeysForDateOnlySlot(slot: PublicAvailabilityBusySlot): string[] {
  if (isTimedBusySlot(slot)) return []
  if (hasTimePart(slot.start) || hasTimePart(slot.end)) {
    if (!isFullDayBusySlot(slot)) return []
  }

  const startKey = hasTimePart(slot.start) ? toTokyoDateKey(new Date(slot.start)) : slot.start
  const exclusiveEndKey = hasTimePart(slot.end) ? toTokyoDateKey(new Date(slot.end)) : slot.end
  if (!DATE_PATTERN.test(startKey) || !DATE_PATTERN.test(exclusiveEndKey) || exclusiveEndKey <= startKey) return []

  const keys: string[] = []
  for (let cursor = startKey; cursor < exclusiveEndKey; cursor = addDays(cursor, 1)) {
    keys.push(cursor)
  }
  return keys
}

function dateKeysForTentativeSlot(slot: PublicAvailabilityBusySlot): string[] {
  return [...dateKeysForTimedSlot(slot), ...dateKeysForDateOnlySlot(slot)]
}

function monthLabel(month: string): string {
  const [year = "", monthNumber = ""] = month.split("-")
  return `${year}年${Number(monthNumber)}月`
}

function rangeForMonth(month: string): PublicAvailabilityMonth["range"] {
  const firstDateKey = `${month}-01`
  const lastDateKey = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`
  const gridStart = addDays(firstDateKey, -dayOfWeek(firstDateKey))
  const gridEnd = addDays(lastDateKey, 6 - dayOfWeek(lastDateKey))
  const afterGridEnd = addDays(gridEnd, 1)

  return {
    start: gridStart,
    end: afterGridEnd,
    timeMin: `${gridStart}T00:00:00.000+09:00`,
    timeMax: `${afterGridEnd}T00:00:00.000+09:00`,
  }
}

export function buildPublicAvailabilityMonth(input: {
  month?: string | null
  now?: Date
  busy?: PublicAvailabilityBusySlot[]
  bookings?: PublicAvailabilityBusySlot[]
  tentative?: PublicAvailabilityBusySlot[]
  tentativeDateKeys?: string[]
}): PublicAvailabilityMonth {
  const now = input.now ?? new Date()
  const month = normalizeMonth(input.month, now)
  const todayDateKey = toTokyoDateKey(now)
  const range = rangeForMonth(month)
  const busyDateKeys = new Set<string>()
  const tentativeDateKeys = new Set(input.tentativeDateKeys ?? [])

  for (const slot of [...(input.busy ?? []), ...(input.bookings ?? [])]) {
    for (const dateKey of dateKeysForTimedSlot(slot)) {
      busyDateKeys.add(dateKey)
    }
  }
  for (const slot of input.tentative ?? []) {
    for (const dateKey of dateKeysForTentativeSlot(slot)) {
      tentativeDateKeys.add(dateKey)
    }
  }

  const days: PublicAvailabilityDay[] = []
  for (let cursor = range.start; cursor < range.end; cursor = addDays(cursor, 1)) {
    if (!DATE_PATTERN.test(cursor)) break
    const { day } = parseDateKey(cursor)
    const isBusy = busyDateKeys.has(cursor)
    const isTentative = !isBusy && tentativeDateKeys.has(cursor)
    days.push({
      dateKey: cursor,
      day,
      inMonth: cursor.startsWith(month),
      isTodayOrPast: cursor <= todayDateKey,
      isBusy,
      isTentative,
      status: isBusy ? "busy" : isTentative ? "tentative" : "available",
    })
  }

  return {
    month,
    monthLabel: monthLabel(month),
    prevMonth: addMonths(month, -1),
    nextMonth: addMonths(month, 1),
    range,
    days,
    busyDateKeys: Array.from(busyDateKeys).sort(),
    tentativeDateKeys: Array.from(tentativeDateKeys).sort(),
  }
}
