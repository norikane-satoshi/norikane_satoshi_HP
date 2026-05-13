import { getHolidayName } from "@/lib/booking/holidays"
import type { CalendarBookingFromApi } from "@/lib/booking/calendar-free-busy"
import type { CalendarBusyEventWithBuffer } from "@/lib/google-calendar"

type MonthSkeletonItem = {
  id: string
  kind: "busy" | "booking" | "buffer"
  label: string
  startsAt: number
}

export type MonthSkeletonDay = {
  key: string
  date: string
  dayNumber: number
  isCurrentMonth: boolean
  isToday: boolean
  holidayName: string | null
  items: MonthSkeletonItem[]
  hiddenItemCount: number
}

type BookingMonthSkeletonProps = {
  initialBusy: CalendarBusyEventWithBuffer[]
  initialBookings: CalendarBookingFromApi[]
  initialRange?: { start: string; end: string }
  now: Date | string
  teamId: string | null
  pending?: boolean
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"]
const DEFAULT_BUSY_BUFFER_HOURS = 1
const CONFIRMED_BOOKING_BUFFER_MS = 7200000
const MAX_ITEMS_PER_DAY = 4

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value)
}

function startOfDay(value: Date): Date {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(value: Date, days: number): Date {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return date
}

function toDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function formatMonthTitle(value: Date): string {
  return `${value.getFullYear()}年${value.getMonth() + 1}月`
}

function hasTimePart(value: string): boolean {
  return /T\d{2}:\d{2}/.test(value)
}

function isFullDayRange(start: string, end: string): boolean {
  if (!hasTimePart(start) || !hasTimePart(end)) return true

  const startDate = new Date(start)
  const endDate = new Date(end)
  return (
    startDate.getHours() === 0 &&
    startDate.getMinutes() === 0 &&
    endDate.getHours() === 0 &&
    endDate.getMinutes() === 0 &&
    endDate.getTime() - startDate.getTime() >= 24 * 60 * 60 * 1000
  )
}

function formatTime(value: string): string {
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function rangeOverlaps(startMs: number, endMs: number, dayStartMs: number, dayEndMs: number): boolean {
  return startMs < dayEndMs && endMs > dayStartMs
}

function busyLabel(slot: CalendarBusyEventWithBuffer): string {
  if (isFullDayRange(slot.start, slot.end)) return "終日 不"
  return `${formatTime(slot.start)} 不`
}

function bookingLabel(booking: CalendarBookingFromApi): string {
  return `${formatTime(booking.start)} 本`
}

function bufferItemsForDay(
  dayStartMs: number,
  dayEndMs: number,
  busy: CalendarBusyEventWithBuffer[],
  bookings: CalendarBookingFromApi[],
): MonthSkeletonItem[] {
  const items: MonthSkeletonItem[] = []

  for (const slot of busy) {
    const hours = slot.bufferHours ?? DEFAULT_BUSY_BUFFER_HOURS
    const bufferMs = Math.max(0, hours) * 60 * 60 * 1000
    const startMs = new Date(slot.start).getTime()
    const endMs = new Date(slot.end).getTime()
    if (bufferMs <= 0) continue

    if (rangeOverlaps(startMs - bufferMs, startMs, dayStartMs, dayEndMs)) {
      items.push({
        id: `busy-buffer-before-${slot.start}-${slot.end}`,
        kind: "buffer",
        label: "保護",
        startsAt: startMs - bufferMs,
      })
    }
    if (rangeOverlaps(endMs, endMs + bufferMs, dayStartMs, dayEndMs)) {
      items.push({
        id: `busy-buffer-after-${slot.start}-${slot.end}`,
        kind: "buffer",
        label: "保護",
        startsAt: endMs,
      })
    }
  }

  for (const booking of bookings) {
    if (booking.status !== "CONFIRMED") continue
    const startMs = new Date(booking.start).getTime()
    const endMs = new Date(booking.end).getTime()

    if (rangeOverlaps(startMs - CONFIRMED_BOOKING_BUFFER_MS, startMs, dayStartMs, dayEndMs)) {
      items.push({
        id: `booking-buffer-before-${booking.id}`,
        kind: "buffer",
        label: "保護",
        startsAt: startMs - CONFIRMED_BOOKING_BUFFER_MS,
      })
    }
    if (rangeOverlaps(endMs, endMs + CONFIRMED_BOOKING_BUFFER_MS, dayStartMs, dayEndMs)) {
      items.push({
        id: `booking-buffer-after-${booking.id}`,
        kind: "buffer",
        label: "保護",
        startsAt: endMs,
      })
    }
  }

  return items
}

export function buildBookingMonthSkeletonDays(input: {
  initialBusy: CalendarBusyEventWithBuffer[]
  initialBookings: CalendarBookingFromApi[]
  now: Date | string
}): MonthSkeletonDay[] {
  const current = toDate(input.now)
  const firstOfMonth = new Date(current.getFullYear(), current.getMonth(), 1)
  const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay())
  const todayKey = toDateKey(startOfDay(current))
  const days: MonthSkeletonDay[] = []

  for (let index = 0; index < 42; index += 1) {
    const date = addDays(gridStart, index)
    const dayStart = startOfDay(date)
    const dayEnd = addDays(dayStart, 1)
    const dayStartMs = dayStart.getTime()
    const dayEndMs = dayEnd.getTime()
    const dayItems: MonthSkeletonItem[] = [
      ...bufferItemsForDay(dayStartMs, dayEndMs, input.initialBusy, input.initialBookings),
      ...input.initialBusy
        .filter((slot) => rangeOverlaps(new Date(slot.start).getTime(), new Date(slot.end).getTime(), dayStartMs, dayEndMs))
        .map((slot) => ({
          id: `busy-${slot.start}-${slot.end}`,
          kind: "busy" as const,
          label: busyLabel(slot),
          startsAt: new Date(slot.start).getTime(),
        })),
      ...input.initialBookings
        .filter((booking) => booking.status === "CONFIRMED")
        .filter((booking) => rangeOverlaps(new Date(booking.start).getTime(), new Date(booking.end).getTime(), dayStartMs, dayEndMs))
        .map((booking) => ({
          id: `booking-${booking.id}`,
          kind: "booking" as const,
          label: bookingLabel(booking),
          startsAt: new Date(booking.start).getTime(),
        })),
    ].sort((a, b) => a.startsAt - b.startsAt)
    const visibleItems = dayItems.slice(0, MAX_ITEMS_PER_DAY)

    days.push({
      key: toDateKey(date),
      date: toDateKey(date),
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === current.getMonth(),
      isToday: toDateKey(date) === todayKey,
      holidayName: getHolidayName(date),
      items: visibleItems,
      hiddenItemCount: Math.max(0, dayItems.length - visibleItems.length),
    })
  }

  return days
}

export function BookingMonthSkeleton({
  initialBusy,
  initialBookings,
  initialRange,
  now,
  teamId,
  pending = false,
}: BookingMonthSkeletonProps) {
  const current = toDate(now)
  const days = buildBookingMonthSkeletonDays({ initialBusy, initialBookings, now })

  return (
    <div
      className={`booking-month-skeleton${pending ? " booking-month-skeleton--pending" : ""}`}
      data-testid="booking-month-skeleton"
      data-state={pending ? "pending" : "ready"}
      data-team-scope={teamId ?? "self"}
      data-range-start={initialRange?.start ?? ""}
      data-range-end={initialRange?.end ?? ""}
      aria-hidden={pending ? undefined : "true"}
      aria-busy={pending ? "true" : undefined}
    >
      <div className="booking-month-skeleton__toolbar">
        <div className="booking-month-skeleton__controls">
          <span className="booking-month-skeleton__control">‹</span>
          <span className="booking-month-skeleton__control">›</span>
          <span className="booking-month-skeleton__control booking-month-skeleton__control--today">今日</span>
        </div>
        <div className="booking-month-skeleton__title">{formatMonthTitle(current)}</div>
        <div className="booking-month-skeleton__spacer" />
      </div>
      <div className="booking-month-skeleton__weekdays">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="booking-month-skeleton__weekday">
            {label}
          </div>
        ))}
      </div>
      <div className="booking-month-skeleton__grid">
        {days.map((day) => (
          <div
            key={day.key}
            className={[
              "booking-month-skeleton__day",
              day.isCurrentMonth ? "" : "booking-month-skeleton__day--muted",
              day.isToday ? "booking-month-skeleton__day--today" : "",
              day.holidayName ? "booking-month-skeleton__day--holiday" : "",
            ].filter(Boolean).join(" ")}
            data-date={day.date}
          >
            <div className="booking-month-skeleton__day-head">
              <span className="booking-month-skeleton__day-number">{day.dayNumber}</span>
              {day.holidayName ? <span className="booking-month-skeleton__holiday-label">{day.holidayName}</span> : null}
            </div>
            <div className="booking-month-skeleton__events">
              {day.items.map((item) => (
                <div
                  key={item.id}
                  className={`booking-month-skeleton__event booking-month-skeleton__event--${item.kind}`}
                  data-testid="booking-month-skeleton-event"
                  data-kind={item.kind}
                >
                  <span className="booking-month-skeleton__lock" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <span className="booking-month-skeleton__event-label">{item.label}</span>
                </div>
              ))}
              {day.hiddenItemCount > 0 ? (
                <div className="booking-month-skeleton__more">+{day.hiddenItemCount}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
