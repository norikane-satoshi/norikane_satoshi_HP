import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

type CapturedFullCalendarProps = Record<string, unknown> & {
  eventDrop: (arg: unknown) => void
}

const fullCalendar = vi.hoisted((): { props: CapturedFullCalendarProps | null } => ({ props: null }))

vi.mock("@fullcalendar/react", () => ({
  default: (props: CapturedFullCalendarProps) => {
    fullCalendar.props = props
    return null
  },
}))
vi.mock("@fullcalendar/daygrid", () => ({ default: {} }))
vi.mock("@fullcalendar/interaction", () => ({ default: {} }))
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }))
vi.mock("@fullcalendar/core/locales/ja", () => ({ default: {} }))
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }))

import { BookingCalendar, shouldConfirmAdminMove } from "@/components/booking/booking-calendar"

function renderCalendar() {
  fullCalendar.props = null
  renderToStaticMarkup(
    React.createElement(BookingCalendar, {
      viewerUserId: "admin_user",
      viewerEmail: "admin@example.com",
      isCalendarAdmin: true,
      teamMemberUserIds: [],
      onCommit: vi.fn(),
    }),
  )
  const props = fullCalendar.props as CapturedFullCalendarProps | null
  if (!props) throw new Error("FullCalendar props were not captured")
  return props
}

function eventDropArg(customerUserId: string) {
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
    revert: vi.fn(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
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
})
