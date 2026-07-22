import type { CalendarBookingFromApi } from "@/lib/booking/server/calendar-free-busy/bookings-repository"
import type { CalendarBusyEventWithBuffer } from "@/lib/google-calendar/server"

type MonthSkeletonItem = {
  id: string
  kind: "lock"
  label: string
  startsAt: number
}

export type MonthSkeletonDay = {
  key: string
  date: string
  dayNumber: number
  isCurrentMonth: boolean
  isToday: boolean
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
  showAvailabilityStatusBlocks?: boolean
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"]
const BOOKING_BUFFER_HOURS = 1
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

function rangeOverlaps(startMs: number, endMs: number, dayStartMs: number, dayEndMs: number): boolean {
  return startMs < dayEndMs && endMs > dayStartMs
}

function toBufferMs(hours: number): number {
  return Math.max(0, hours) * 60 * 60 * 1000
}

function hasTimePart(value: string): boolean {
  return /T\d{2}:\d{2}/.test(value)
}

function isTimedBusySlot(slot: CalendarBusyEventWithBuffer): boolean {
  return hasTimePart(slot.start) && hasTimePart(slot.end)
}

function bufferItemsForDay(
  dayStartMs: number,
  dayEndMs: number,
  busy: CalendarBusyEventWithBuffer[],
  bookings: CalendarBookingFromApi[],
): MonthSkeletonItem[] {
  const items: MonthSkeletonItem[] = []

  for (const slot of busy) {
    if (!isTimedBusySlot(slot)) continue
    const hours = slot.bufferHours ?? BOOKING_BUFFER_HOURS
    const bufferMs = toBufferMs(hours)
    const startMs = new Date(slot.start).getTime()
    const endMs = new Date(slot.end).getTime()
    if (bufferMs <= 0) continue

    if (rangeOverlaps(startMs - bufferMs, startMs, dayStartMs, dayEndMs)) {
      items.push({
        id: `busy-buffer-before-${slot.start}-${slot.end}`,
        kind: "lock",
        label: "保護",
        startsAt: startMs - bufferMs,
      })
    }
    if (rangeOverlaps(endMs, endMs + bufferMs, dayStartMs, dayEndMs)) {
      items.push({
        id: `busy-buffer-after-${slot.start}-${slot.end}`,
        kind: "lock",
        label: "保護",
        startsAt: endMs,
      })
    }
  }

  for (const booking of bookings) {
    if (booking.status !== "CONFIRMED") continue
    const startMs = new Date(booking.start).getTime()
    const endMs = new Date(booking.end).getTime()
    const bufferMs = toBufferMs(BOOKING_BUFFER_HOURS)

    if (rangeOverlaps(startMs - bufferMs, startMs, dayStartMs, dayEndMs)) {
      items.push({
        id: `booking-buffer-before-${booking.id}`,
        kind: "lock",
        label: "保護",
        startsAt: startMs - bufferMs,
      })
    }
    if (rangeOverlaps(endMs, endMs + bufferMs, dayStartMs, dayEndMs)) {
      items.push({
        id: `booking-buffer-after-${booking.id}`,
        kind: "lock",
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
    const dayItems = [
      ...bufferItemsForDay(dayStartMs, dayEndMs, input.initialBusy, input.initialBookings),
      ...input.initialBusy
        .filter(isTimedBusySlot)
        .filter((slot) => rangeOverlaps(new Date(slot.start).getTime(), new Date(slot.end).getTime(), dayStartMs, dayEndMs))
        .map((slot) => ({
          id: `busy-${slot.start}-${slot.end}`,
          kind: "lock" as const,
          label: "予約不可",
          startsAt: new Date(slot.start).getTime(),
        })),
      ...input.initialBookings
        .filter((booking) => booking.status === "CONFIRMED")
        .filter((booking) => rangeOverlaps(new Date(booking.start).getTime(), new Date(booking.end).getTime(), dayStartMs, dayEndMs))
        .map((booking) => ({
          id: `booking-${booking.id}`,
          kind: "lock" as const,
          label: "予約不可",
          startsAt: new Date(booking.start).getTime(),
        })),
    ].sort((a, b) => a.startsAt - b.startsAt)
    const visibleItems: MonthSkeletonItem[] = dayItems.length > 0
      ? [{
          id: `date-lock-${toDateKey(date)}`,
          kind: "lock",
          label: "予約不可",
          startsAt: dayItems[0]?.startsAt ?? dayStartMs,
        }]
      : []

    days.push({
      key: toDateKey(date),
      date: toDateKey(date),
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === current.getMonth(),
      isToday: toDateKey(date) === todayKey,
      items: visibleItems,
      hiddenItemCount: 0,
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
  showAvailabilityStatusBlocks = false,
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
      data-availability-status-blocks={showAvailabilityStatusBlocks ? "true" : "false"}
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
            ].filter(Boolean).join(" ")}
            data-date={day.date}
          >
            <div className="booking-month-skeleton__day-head">
              <span className="booking-month-skeleton__day-number">{day.dayNumber}</span>
            </div>
            <div className="booking-month-skeleton__events">
              {day.items.map((item) => (
                <div
                  key={item.id}
                  className={`booking-month-skeleton__event booking-month-skeleton__event--${item.kind}`}
                  data-testid="booking-month-skeleton-event"
                  data-kind={item.kind}
                  aria-label={item.label}
                  title={item.label}
                >
                  <span className="booking-month-skeleton__lock" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <span className="booking-month-skeleton__event-label" aria-hidden="true" />
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
