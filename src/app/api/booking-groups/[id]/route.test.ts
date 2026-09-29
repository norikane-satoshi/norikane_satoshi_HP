import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findAccessibleBookingGroup: vi.fn(),
  getCachedCalendarAccessToken: vi.fn(),
  cancelBookingGroupCalendarEvents: vi.fn(),
  replaceBookingGroupCalendarEventIntents: vi.fn(),
  bookingGroupDelete: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/auth/server/is-admin", () => ({ isAdmin: () => false }))
vi.mock("@/lib/booking/server/edit-access", () => ({
  findAccessibleBookingGroup: mocks.findAccessibleBookingGroup,
}))
vi.mock("@/lib/booking/server/calendar-free-busy/google-token-cache", () => ({
  getCachedCalendarAccessToken: mocks.getCachedCalendarAccessToken,
}))
vi.mock("@/lib/booking/server/calendar-event-lifecycle", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/booking/server/calendar-event-lifecycle")>()
  return {
    ...original,
    cancelBookingGroupCalendarEvents: mocks.cancelBookingGroupCalendarEvents,
    replaceBookingGroupCalendarEventIntents: mocks.replaceBookingGroupCalendarEventIntents,
  }
})
vi.mock("@/lib/google-calendar/server", () => ({ CALENDAR_TOKEN_USER_ID: "calendar-owner" }))
vi.mock("@/lib/prisma", () => ({ prisma: { bookingGroup: { delete: mocks.bookingGroupDelete } } }))

import { DELETE, PATCH } from "./route"

function group() {
  return {
    bookingGroupId: "group_1",
    scope: "owner",
    details: {
      projectTitle: "Project",
      contactName: "Client",
      customerEmail: "client@example.com",
      phone: null,
      companyName: null,
      memo: null,
      dueDate: null,
      teamId: null,
      customerUserId: "user_1",
      status: "NEEDS_SCHEDULE",
    },
    timeSlots: [],
  }
}

const context = { params: Promise.resolve({ id: "group_1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("GOOGLE_CALENDAR_BUSY_SOURCE_ID", "calendar_1")
  mocks.auth.mockResolvedValue({ user: { id: "user_1", email: "client@example.com" } })
  mocks.findAccessibleBookingGroup.mockResolvedValue(group())
  mocks.getCachedCalendarAccessToken.mockResolvedValue({ token: "token" })
  mocks.cancelBookingGroupCalendarEvents.mockResolvedValue({ complete: true, results: [] })
  mocks.replaceBookingGroupCalendarEventIntents.mockResolvedValue({
    complete: true,
    upsertResults: [],
    deleteResults: [],
  })
  mocks.bookingGroupDelete.mockResolvedValue({})
})

describe("/api/booking-groups/[id]", () => {
  it("cancels every calendar event through the group lifecycle", async () => {
    const response = await DELETE(
      new NextRequest("http://localhost/api/booking-groups/group_1", { method: "DELETE" }),
      context,
    )
    expect(response.status).toBe(200)
    expect(mocks.cancelBookingGroupCalendarEvents).toHaveBeenCalledWith({
      bookingGroupId: "group_1",
      calendarId: "calendar_1",
      accessToken: "token",
    })
  })

  it("returns a durable pending response when any deletion must be retried", async () => {
    mocks.cancelBookingGroupCalendarEvents.mockResolvedValue({ complete: false, results: [] })
    const response = await DELETE(
      new NextRequest("http://localhost/api/booking-groups/group_1", { method: "DELETE" }),
      context,
    )
    expect(response.status).toBe(202)
    expect(response.headers.get("Retry-After")).toBe("60")
    await expect(response.json()).resolves.toMatchObject({ status: "pending_reconcile" })
  })

  it("replaces arbitrary requested dates without filling an unrequested gap", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/booking-groups/group_1", {
        method: "PATCH",
        body: JSON.stringify({ requestedDates: ["2026-11-01", "2026-11-03", "2026-11-04"] }),
      }),
      context,
    )
    expect(response.status).toBe(200)
    const call = mocks.replaceBookingGroupCalendarEventIntents.mock.calls[0]?.[0]
    expect(call.intents.map((intent: { eventId: string; startValue: string; endValue: string }) => ({
      id: intent.eventId,
      start: intent.startValue,
      end: intent.endValue,
    }))).toEqual([
      { id: "group1", start: "2026-11-01", end: "2026-11-02" },
      { id: "group120261103", start: "2026-11-03", end: "2026-11-04" },
      { id: "group120261104", start: "2026-11-04", end: "2026-11-05" },
    ])
  })

  it("does not expose another user's booking group", async () => {
    mocks.findAccessibleBookingGroup.mockResolvedValue(null)
    const response = await DELETE(
      new NextRequest("http://localhost/api/booking-groups/group_1", { method: "DELETE" }),
      context,
    )
    expect(response.status).toBe(404)
    expect(mocks.cancelBookingGroupCalendarEvents).not.toHaveBeenCalled()
  })
})
