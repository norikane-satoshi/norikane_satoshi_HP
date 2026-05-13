import {
  addDays,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns"

export type BookingWithRelations = {
  startTime: Date | string
  endTime: Date | string
}

export function parseMonth(month: string): {
  year: number
  monthNum: number
  monthDate: Date
} {
  const [yearStr, monthStr] = month.split("-")
  const year = Number.parseInt(yearStr, 10)
  const monthNum = Number.parseInt(monthStr, 10)
  const monthDate = new Date(year, monthNum - 1, 1)
  return { year, monthNum, monthDate }
}

export function getCalendarDays(month: string): Date[] {
  const { monthDate } = parseMonth(month)
  const monthStart = startOfMonth(monthDate)
  const monthEnd = endOfMonth(monthDate)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
  return eachDayOfInterval({ start: calStart, end: calEnd })
}

export function groupBookingsByDate(
  bookings: BookingWithRelations[],
): Map<string, BookingWithRelations[]> {
  const map = new Map<string, BookingWithRelations[]>()
  for (const booking of bookings) {
    const bookingStart = startOfDay(new Date(booking.startTime))
    const bookingEnd = startOfDay(new Date(booking.endTime))
    const days = eachDayOfInterval({ start: bookingStart, end: bookingEnd })
    for (const day of days) {
      const key = format(day, "yyyy-MM-dd")
      const existing = map.get(key) ?? []
      existing.push(booking)
      map.set(key, existing)
    }
  }

  for (const [, list] of map) {
    list.sort((a, b) => {
      const startDiff = new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      if (startDiff !== 0) return startDiff
      return new Date(a.endTime).getTime() - new Date(b.endTime).getTime()
    })
  }
  return map
}

export function splitIntoWeeks(days: Date[]): Date[][] {
  const result: Date[][] = []
  for (let i = 0; i < days.length; i += 7) {
    result.push(days.slice(i, i + 7))
  }
  return result
}

export function formatMonth(month: string): string {
  const { monthDate } = parseMonth(month)
  return format(monthDate, "yyyy年M月")
}

export function normalizeCalendarDate(date: string | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const parsed = parseISO(date)
  if (!isValid(parsed)) return null
  return format(parsed, "yyyy-MM-dd")
}

export function getCurrentDateKey(): string {
  return format(new Date(), "yyyy-MM-dd")
}

export function getWeekDays(date: string): Date[] {
  const normalized = normalizeCalendarDate(date) ?? getCurrentDateKey()
  const parsed = parseISO(normalized)
  const weekStart = startOfWeek(parsed, { weekStartsOn: 0 })
  const weekEnd = endOfWeek(parsed, { weekStartsOn: 0 })
  return eachDayOfInterval({ start: weekStart, end: weekEnd })
}

export function getMonthFromDate(date: string): string {
  const normalized = normalizeCalendarDate(date) ?? getCurrentDateKey()
  return format(parseISO(normalized), "yyyy-MM")
}

export function navigateDay(currentDate: string, offset: number): string {
  const normalized = normalizeCalendarDate(currentDate) ?? getCurrentDateKey()
  const parsed = parseISO(normalized)
  return format(addDays(parsed, offset), "yyyy-MM-dd")
}

export function navigateWeek(currentDate: string, offset: number): string {
  const normalized = normalizeCalendarDate(currentDate) ?? getCurrentDateKey()
  const parsed = parseISO(normalized)
  return format(addWeeks(parsed, offset), "yyyy-MM-dd")
}

export function formatWeek(date: string): string {
  const weekDays = getWeekDays(date)
  const weekStart = weekDays[0]
  const weekEnd = weekDays[weekDays.length - 1]

  if (format(weekStart, "yyyy-MM") === format(weekEnd, "yyyy-MM")) {
    return `${format(weekStart, "yyyy年M月d日")} - ${format(weekEnd, "d日")}`
  }

  if (format(weekStart, "yyyy") === format(weekEnd, "yyyy")) {
    return `${format(weekStart, "yyyy年M月d日")} - ${format(weekEnd, "M月d日")}`
  }

  return `${format(weekStart, "yyyy年M月d日")} - ${format(weekEnd, "yyyy年M月d日")}`
}

export function navigateMonth(currentMonth: string, offset: number): string {
  const { year, monthNum } = parseMonth(currentMonth)
  const target = new Date(year, monthNum - 1 + offset, 1)
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`
}

export function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}
