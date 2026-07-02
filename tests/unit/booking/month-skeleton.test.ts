import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { createElement } from "react"

import {
  BookingMonthSkeleton,
  buildBookingMonthSkeletonDays,
} from "@/components/booking/booking-month-skeleton"
import type { CalendarBookingFromApi } from "@/lib/booking/server/calendar-free-busy/bookings-repository"
import type { CalendarBusyEventWithBuffer } from "@/lib/google-calendar/server"

const busy: CalendarBusyEventWithBuffer[] = [
  {
    start: "2026-05-21T12:00:00.000Z",
    end: "2026-05-21T13:00:00.000Z",
    bufferHours: 1,
    bufferBeforeHours: null,
    bufferAfterHours: null,
    summary: null,
  },
]

const bookings: CalendarBookingFromApi[] = [
  {
    id: "booking_1",
    bookingGroupId: "group_1",
    customerUserId: "user_1",
    start: "2026-05-20T12:00:00.000Z",
    end: "2026-05-20T13:30:00.000Z",
    title: "SSR test",
    status: "CONFIRMED",
    bufferBeforeHours: 1,
    bufferAfterHours: 1,
  },
]

describe("BookingMonthSkeleton", () => {
  it("compresses confirmed bookings and busy slots into one lock marker per day", () => {
    const days = buildBookingMonthSkeletonDays({
      initialBusy: busy,
      initialBookings: bookings,
      now: "2026-05-12T12:00:00.000Z",
    })

    expect(days).toHaveLength(42)
    expect(days[0]?.date).toBe("2026-04-26")
    expect(days.find((day) => day.date === "2026-05-20")?.items).toEqual([
      expect.objectContaining({ kind: "lock", label: "予約不可" }),
    ])
    expect(days.find((day) => day.date === "2026-05-21")?.items).toEqual([
      expect.objectContaining({ kind: "lock", label: "予約不可" }),
    ])
  })

  it("does not render date-only busy slots as lock markers", () => {
    const days = buildBookingMonthSkeletonDays({
      initialBusy: [
        {
          start: "2026-05-22",
          end: "2026-05-23",
          bufferHours: 1,
          bufferBeforeHours: null,
          bufferAfterHours: null,
          summary: "Date-only schedule",
        },
      ],
      initialBookings: [],
      now: "2026-05-12T12:00:00.000Z",
    })

    expect(days.find((day) => day.date === "2026-05-22")?.items).toEqual([])
  })

  it("server-renders the static month grid with event markers", () => {
    const html = renderToStaticMarkup(createElement(BookingMonthSkeleton, {
      initialBusy: busy,
      initialBookings: bookings,
      initialRange: {
        start: "2026-04-01T00:00:00.000Z",
        end: "2026-07-01T00:00:00.000Z",
      },
      now: "2026-05-12T12:00:00.000Z",
      teamId: null,
    }))

    expect(html).toContain('data-testid="booking-month-skeleton"')
    expect(html).toContain('data-state="ready"')
    expect(html).toContain('data-date="2026-05-20"')
    expect(html).toContain('data-kind="lock"')
    expect(html).not.toContain(">予約不可<")
    expect(html).not.toContain(">不<")
    expect(html).not.toContain(">本<")
  })

  it("server-renders an empty pending grid for streaming fallback", () => {
    const html = renderToStaticMarkup(createElement(BookingMonthSkeleton, {
      initialBusy: [],
      initialBookings: [],
      initialRange: {
        start: "2026-04-01T00:00:00.000Z",
        end: "2026-07-01T00:00:00.000Z",
      },
      now: "2026-05-12T12:00:00.000Z",
      teamId: null,
      pending: true,
    }))

    expect(html).toContain('data-state="pending"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('data-date="2026-04-26"')
    expect(html).toContain('data-date="2026-06-06"')
    expect(html).not.toContain('data-kind="lock"')
  })
})
