import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

type CapturedFullCalendarProps = Record<string, unknown> & {
  eventDrop: (arg: unknown) => void
  eventResize: (arg: unknown) => void
}

const fullCalendar = vi.hoisted((): {
  props: CapturedFullCalendarProps | null
  refetchRemoteEvents: ReturnType<typeof vi.fn>
} => ({
  props: null,
  refetchRemoteEvents: vi.fn(),
}))

vi.mock("@fullcalendar/react", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react")
  return {
    default: ReactModule.forwardRef((props: Record<string, unknown>, ref: React.ForwardedRef<unknown>) => {
      fullCalendar.props = props as CapturedFullCalendarProps
      const api = {
        getApi: () => ({
          getEventSourceById: (id: string) => (id === "remote-events" ? { refetch: fullCalendar.refetchRemoteEvents } : null),
        }),
      }
      if (typeof ref === "function") ref(api)
      else if (ref) ref.current = api
      return null
    }),
  }
})
vi.mock("@fullcalendar/daygrid", () => ({ default: {} }))
vi.mock("@fullcalendar/interaction", () => ({ default: {} }))
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }))
vi.mock("@fullcalendar/core/locales/ja", () => ({ default: {} }))
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }))

import { BookingCalendar, isDateKeyTodayOrPast, shouldConfirmAdminMove } from "@/components/booking/booking-calendar"

type BookingCalendarTestProps = React.ComponentProps<typeof BookingCalendar>

function calendarProps(overrides: Partial<BookingCalendarTestProps> = {}): BookingCalendarTestProps {
  return {
    viewerUserId: "admin_user",
    viewerEmail: "admin@example.com",
    isCalendarAdmin: true,
    teamMemberUserIds: [],
    initialRange: {
      start: "2099-05-18T00:00:00.000Z",
      end: "2099-05-19T00:00:00.000Z",
    },
    initialBookings: [{
      id: "slot_1",
      bookingGroupId: "group_1",
      customerUserId: "admin_user",
      start: "2099-05-18T01:00:00.000Z",
      end: "2099-05-18T02:00:00.000Z",
      title: "Project",
      status: "CONFIRMED",
      bufferBeforeHours: 1,
      bufferAfterHours: 1,
    }],
    onCommit: vi.fn(),
    ...overrides,
  }
}

function renderCalendarMarkup(overrides: Partial<BookingCalendarTestProps> = {}) {
  fullCalendar.props = null
  return renderToStaticMarkup(React.createElement(BookingCalendar, calendarProps(overrides)))
}

function renderCalendar() {
  renderCalendarMarkup()
  const props = fullCalendar.props as CapturedFullCalendarProps | null
  if (!props) throw new Error("FullCalendar props were not captured")
  return props
}

function eventDropArg(customerUserId: string, revert = vi.fn()) {
  return {
    event: {
      start: new Date("2099-05-18T02:00:00.000Z"),
      end: new Date("2099-05-18T03:00:00.000Z"),
      extendedProps: {
        kind: "busy" as const,
        label: "10:00-11:00",
        status: "CONFIRMED" as const,
        bookingId: "slot_1",
        bookingGroupId: "group_1",
        customerUserId,
        projectTitle: "Project",
      },
    },
    oldEvent: {
      start: new Date("2099-05-18T01:00:00.000Z"),
      end: new Date("2099-05-18T02:00:00.000Z"),
    },
    jsEvent: { clientX: 10, clientY: 20 },
    revert,
  }
}

function bufferResizeArg(revert = vi.fn()) {
  return {
    event: {
      start: new Date("2099-05-18T00:30:00.000Z"),
      end: new Date("2099-05-18T01:00:00.000Z"),
      extendedProps: {
        kind: "buffer" as const,
        bookingId: "slot_1",
        bookingGroupId: "group_1",
        side: "before" as const,
        bookingStart: "2099-05-18T01:00:00.000Z",
        bookingEnd: "2099-05-18T02:00:00.000Z",
      },
    },
    oldEvent: {
      start: new Date("2099-05-18T00:00:00.000Z"),
      end: new Date("2099-05-18T01:00:00.000Z"),
    },
    revert,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  fullCalendar.refetchRemoteEvents.mockClear()
})

describe("BookingCalendar admin move confirmation", () => {
  it("moves an admin-owned confirmed booking immediately without opening the confirmation path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchMock)
    const props = renderCalendar()
    const arg = eventDropArg("admin_user")

    props.eventDrop(arg)
    await Promise.resolve()
    await Promise.resolve()

    expect(shouldConfirmAdminMove(arg.event.extendedProps, "admin_user", true)).toBe(false)
    expect(arg.revert).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith("/api/booking/slot_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "move",
        start: "2099-05-18T02:00:00.000Z",
        end: "2099-05-18T03:00:00.000Z",
      }),
    })
    expect(fullCalendar.refetchRemoteEvents).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/calendar/free-busy"), expect.anything())
  })

  it("reverts an optimistic admin-owned move when PATCH fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "slot_taken" }),
    })
    const revert = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const props = renderCalendar()
    const arg = eventDropArg("admin_user", revert)

    props.eventDrop(arg)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(revert).toHaveBeenCalledTimes(1)
    expect(fullCalendar.refetchRemoteEvents).toHaveBeenCalledTimes(2)
  })

  it("keeps the confirmation path for another user's confirmed booking", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const props = renderCalendar()
    const arg = eventDropArg("customer_user")

    props.eventDrop(arg)

    expect(shouldConfirmAdminMove(arg.event.extendedProps, "admin_user", true)).toBe(true)
    expect(arg.revert).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("optimistically patches admin buffer resize without a free-busy refetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchMock)
    const props = renderCalendar()
    const arg = bufferResizeArg()

    props.eventResize(arg)
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledWith("/api/booking/slot_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "resize_buffer",
        side: "before",
        hours: 0.5,
      }),
    })
    expect(arg.revert).not.toHaveBeenCalled()
    expect(fullCalendar.refetchRemoteEvents).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/calendar/free-busy"), expect.anything())
  })

  it("passes eventResizableFromStart to FullCalendar", () => {
    const props = renderCalendar()

    expect(props.eventResizableFromStart).toBe(true)
  })
})

describe("BookingCalendar date request guards", () => {
  it("treats today and past dates as unavailable using the provided date key", () => {
    expect(isDateKeyTodayOrPast("2026-07-01", "2026-07-01")).toBe(true)
    expect(isDateKeyTodayOrPast("2026-06-30", "2026-07-01")).toBe(true)
    expect(isDateKeyTodayOrPast("2026-07-02", "2026-07-01")).toBe(false)
  })
})

describe("BookingCalendar account scope display", () => {
  it("does not render the personal scope selector when there are no teams", () => {
    const html = renderCalendarMarkup({
      onSelectedTeamIdChange: vi.fn(),
      teams: [],
      viewerEmail: "",
    })

    expect(html).not.toContain("booking-team-scope")
    expect(html).not.toContain("個人")
  })
})
