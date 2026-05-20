import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findAccessibleSlot: vi.fn(),
  isAdmin: vi.fn(),
  prisma: {
    bookingGroup: {
      update: vi.fn(),
      delete: vi.fn(),
    },
    bookingTimeSlot: {
      update: vi.fn(),
    },
  },
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/auth/server/is-admin", () => ({ isAdmin: mocks.isAdmin }))
vi.mock("@/lib/booking/server/edit-access", () => ({ findAccessibleSlot: mocks.findAccessibleSlot }))
vi.mock("@/lib/booking/server/calendar-free-busy/free-busy", () => ({
  invalidateCalendarFreeBusyCacheForUser: vi.fn(),
}))
vi.mock("@/lib/booking/server/calendar-free-busy/google-token-cache", () => ({
  getCachedCalendarAccessToken: vi.fn(),
}))
vi.mock("@/lib/booking/server/conflicts", () => ({ findConflictingBookings: vi.fn() }))
vi.mock("@/lib/booking/server/email", () => ({ sendBookingTimeChangedEmail: vi.fn() }))
vi.mock("@/lib/google-calendar/server", () => ({
  CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
  deleteCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import { DELETE, PATCH } from "@/app/api/booking/[id]/route"

function request(method: string, body?: unknown) {
  const raw = body === undefined ? undefined : JSON.stringify(body)
  return new NextRequest("http://localhost/api/booking/slot_1", {
    method,
    body: raw,
    headers: raw === undefined ? undefined : { "Content-Length": String(Buffer.byteLength(raw)) },
  })
}

function context() {
  return { params: Promise.resolve({ id: "slot_1" }) }
}

function teamMemberBooking() {
  return {
    bookingId: "slot_1",
    bookingGroupId: "group_1",
    scope: "team_member",
    gcalEventId: null,
    details: {
      customerUserId: "owner_user",
      customerEmail: "owner@example.com",
      projectTitle: "Project",
      teamId: "team_1",
    },
    timeSlots: [
      {
        id: "slot_1",
        startTime: new Date("2099-05-20T00:00:00.000Z"),
        endTime: new Date("2099-05-20T01:00:00.000Z"),
      },
    ],
  }
}

describe("/api/booking/[id] ID enumeration hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { id: "team_user", email: "team@example.com" } })
    mocks.isAdmin.mockReturnValue(false)
    mocks.findAccessibleSlot.mockResolvedValue(teamMemberBooking())
  })

  it("returns 404 for another user's booking PATCH", async () => {
    const response = await PATCH(request("PATCH", { action: "update_details", memo: "x" }), context())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "not_found" })
    expect(mocks.prisma.bookingGroup.update).not.toHaveBeenCalled()
  })

  it("returns 404 for another user's booking DELETE", async () => {
    const response = await DELETE(request("DELETE"), context())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "not_found" })
    expect(mocks.prisma.bookingTimeSlot.update).not.toHaveBeenCalled()
  })
})
