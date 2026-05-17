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
  },
]

describe("BookingMonthSkeleton", () => {
  it("places confirmed bookings and busy slots into their month day cells", () => {
    const days = buildBookingMonthSkeletonDays({
      initialBusy: busy,
      initialBookings: bookings,
      now: "2026-05-12T12:00:00.000Z",
    })

    expect(days).toHaveLength(42)
    expect(days[0]?.date).toBe("2026-04-26")
    expect(days.find((day) => day.date === "2026-05-20")?.items.some((item) => item.kind === "booking")).toBe(true)
    expect(days.find((day) => day.date === "2026-05-21")?.items.some((item) => item.kind === "busy")).toBe(true)
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
    expect(html).toContain('data-kind="booking"')
    expect(html).toContain('data-kind="busy"')
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
    expect(html).not.toContain('data-kind="booking"')
    expect(html).not.toContain('data-kind="busy"')
  })
})
