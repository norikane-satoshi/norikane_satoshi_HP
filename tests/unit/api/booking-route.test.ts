import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  evaluateConflicts: vi.fn(),
  findConflictingBookings: vi.fn(),
  resolveConflictForFinalSubmit: vi.fn(),
  isTeamMember: vi.fn(),
  invalidateCalendarFreeBusyCacheForUser: vi.fn(),
  sendBookingConfirmedEmail: vi.fn(),
  refreshCalendarAccessToken: vi.fn(),
  createCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  prisma: {
    customer: {
      upsert: vi.fn(),
    },
    bookingGroup: {
      create: vi.fn(),
      update: vi.fn(),
    },
    bookingTimeSlot: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    calendarToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/booking/conflicts", () => ({
  evaluateConflicts: mocks.evaluateConflicts,
  findConflictingBookings: mocks.findConflictingBookings,
  resolveConflictForFinalSubmit: mocks.resolveConflictForFinalSubmit,
}))
vi.mock("@/lib/booking/team-access", () => ({ isTeamMember: mocks.isTeamMember }))
vi.mock("@/lib/booking/calendar-free-busy", () => ({
  invalidateCalendarFreeBusyCacheForUser: mocks.invalidateCalendarFreeBusyCacheForUser,
}))
vi.mock("@/lib/booking/email", () => ({ sendBookingConfirmedEmail: mocks.sendBookingConfirmedEmail }))
vi.mock("@/lib/google-calendar", () => ({
  CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
  createCalendarEvent: mocks.createCalendarEvent,
  deleteCalendarEvent: mocks.deleteCalendarEvent,
  refreshCalendarAccessToken: mocks.refreshCalendarAccessToken,
}))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import { POST } from "@/app/api/booking/route"
import { DELETE, PATCH } from "@/app/api/booking/[id]/route"
import { POST as POSTConflicts } from "@/app/api/booking/conflicts/route"

function request(body: unknown) {
  return new NextRequest("http://localhost/api/booking", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

function validBooking(overrides: Record<string, unknown> = {}) {
  return {
    projectTitle: "Color grading",
    dueDate: "2026-06-30",
    companyName: "NCS",
    contactName: "Satoshi",
    sessionEmail: "satoshi@example.com",
    contactEmail: "",
    phone: "",
    memo: "",
    agreed: true,
    selectedSlots: [
      {
        start: "2026-06-10T01:00:00.000Z",
        end: "2026-06-10T02:00:00.000Z",
      },
    ],
    ...overrides,
  }
}

function mockHappyPath() {
  mocks.auth.mockResolvedValue({
    user: { id: "user_1", email: "satoshi@example.com" },
  })
  mocks.prisma.customer.upsert.mockResolvedValue({ id: "customer_1" })
  mocks.findConflictingBookings.mockResolvedValue([])
  mocks.resolveConflictForFinalSubmit.mockReturnValue(null)
  mocks.sendBookingConfirmedEmail.mockResolvedValue({ skipped: true })
  mocks.prisma.calendarToken.findUnique.mockResolvedValue({
    refreshToken: "refresh_token",
  })
  mocks.refreshCalendarAccessToken.mockResolvedValue({
    accessToken: "access_token",
    expiresAt: new Date("2026-06-10T00:00:00.000Z"),
    scope: "scope",
  })
  mocks.createCalendarEvent.mockResolvedValue({ id: "gcal_1" })
  mocks.prisma.bookingGroup.create.mockResolvedValue({
    id: "group_1",
    timeSlots: [{ id: "slot_1" }],
  })
  mocks.prisma.bookingGroup.update.mockResolvedValue({})
  process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID = "calendar_1"
}

describe("POST /api/booking", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
  })

  it("creates a personal booking with teamId null", async () => {
    mockHappyPath()

    const response = await POST(request(validBooking({ teamId: null })))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      status: "ok",
      bookingGroupId: "group_1",
      bookingIds: ["slot_1"],
      bookingStatus: "CONFIRMED",
    })
    expect(mocks.isTeamMember).not.toHaveBeenCalled()
    expect(mocks.prisma.bookingGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teamId: null }),
      }),
    )
    expect(mocks.invalidateCalendarFreeBusyCacheForUser).toHaveBeenCalledWith("user_1", null)
  })

  it("rejects team bookings when the user is not a member", async () => {
    mockHappyPath()
    mocks.isTeamMember.mockResolvedValue(false)

    const response = await POST(request(validBooking({ teamId: "team_1" })))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
  })

  it("creates a team booking when the user is a member", async () => {
    mockHappyPath()
    mocks.isTeamMember.mockResolvedValue(true)

    const response = await POST(request(validBooking({ teamId: "team_1" })))

    expect(response.status).toBe(200)
    expect(mocks.isTeamMember).toHaveBeenCalledWith("user_1", "team_1")
    expect(mocks.prisma.bookingGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teamId: "team_1" }),
      }),
    )
    expect(mocks.invalidateCalendarFreeBusyCacheForUser).toHaveBeenCalledWith("user_1", "team_1")
  })

  it("returns invalid_request for malformed input", async () => {
    mockHappyPath()

    const response = await POST(request({ projectTitle: "" }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" })
  })

  it("returns slot_taken when conflict resolution blocks the slot", async () => {
    mockHappyPath()
    mocks.findConflictingBookings.mockResolvedValue([{ id: "slot_busy" }])
    mocks.resolveConflictForFinalSubmit.mockReturnValue("slot_taken")

    const response = await POST(request(validBooking()))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "slot_taken" })
  })

  it("returns unauthorized when session email differs from the submitted email", async () => {
    mockHappyPath()
    mocks.auth.mockResolvedValue({
      user: { id: "user_1", email: "other@example.com" },
    })

    const response = await POST(request(validBooking()))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
  })

  it("creates the booking and returns 207 when GOOGLE_CALENDAR_BUSY_SOURCE_ID is missing", async () => {
    mockHappyPath()
    delete process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID

    const response = await POST(request(validBooking()))
    const json = await response.json()

    expect(response.status).toBe(207)
    expect(json).toMatchObject({
      status: "ok_with_warning",
      bookingGroupId: "group_1",
      bookingIds: ["slot_1"],
      bookingStatus: "CONFIRMED",
      gcalError: "GOOGLE_CALENDAR_BUSY_SOURCE_ID is not set",
    })
    expect(mocks.createCalendarEvent).not.toHaveBeenCalled()
    expect(mocks.invalidateCalendarFreeBusyCacheForUser).toHaveBeenCalledWith("user_1", null)
  })
})

describe("POST /api/booking/conflicts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 for unauthenticated conflict checks", async () => {
    mocks.auth.mockResolvedValue(null)

    const response = await POSTConflicts(request({
      start: "2026-06-10T01:00:00.000Z",
      end: "2026-06-10T02:00:00.000Z",
    }))

    expect(response.status).toBe(401)
  })

  it("returns invalid_request for reversed conflict checks", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })

    const response = await POSTConflicts(request({
      start: "2026-06-10T02:00:00.000Z",
      end: "2026-06-10T01:00:00.000Z",
    }))

    expect(response.status).toBe(400)
  })

  it("returns ok when no conflict exists", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.findConflictingBookings.mockResolvedValue([])
    mocks.evaluateConflicts.mockReturnValue({ kind: "ok" })
    mocks.resolveConflictForFinalSubmit.mockReturnValue(null)

    const response = await POSTConflicts(request({
      start: "2026-06-10T01:00:00.000Z",
      end: "2026-06-10T02:00:00.000Z",
      excludeBookingId: "slot_1",
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ verdict: "ok" })
  })

  it("returns block when a confirmed conflict exists", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.findConflictingBookings.mockResolvedValue([{ id: "slot_busy" }])
    mocks.evaluateConflicts.mockReturnValue({ kind: "block", code: "slot_taken" })
    mocks.resolveConflictForFinalSubmit.mockReturnValue("slot_taken")

    const response = await POSTConflicts(request({
      start: "2026-06-10T01:00:00.000Z",
      end: "2026-06-10T02:00:00.000Z",
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      verdict: "block",
      reason: "slot_taken",
      message: "この時間枠は既に予約が確定しています",
    })
  })
})

describe("/api/booking/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function context(id = "slot_1") {
    return { params: Promise.resolve({ id }) }
  }

  function ownedSlot(overrides: Record<string, unknown> = {}) {
    return {
      id: "slot_1",
      bookingGroupId: "group_1",
      status: "CONFIRMED",
      bookingGroup: {
        status: "CONFIRMED",
        gcalEventId: null,
        customer: { userId: "user_1" },
      },
      ...overrides,
    }
  }

  it("deletes an owned slot and clears its Google Calendar event", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.prisma.bookingTimeSlot.findUnique.mockResolvedValue(
      ownedSlot({ bookingGroup: { status: "CONFIRMED", gcalEventId: "gcal_1", customer: { userId: "user_1" } } }),
    )
    mocks.prisma.bookingTimeSlot.update.mockResolvedValue({})
    mocks.deleteCalendarEvent.mockResolvedValue({})
    mocks.prisma.bookingGroup.update.mockResolvedValue({})

    const response = await DELETE(new NextRequest("http://localhost/api/booking/slot_1"), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: "ok", bookingId: "slot_1" })
    expect(mocks.deleteCalendarEvent).toHaveBeenCalledWith("gcal_1")
  })

  it("rejects missing or unowned slots", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.prisma.bookingTimeSlot.findUnique.mockResolvedValue(
      ownedSlot({ bookingGroup: { status: "CONFIRMED", gcalEventId: null, customer: { userId: "other" } } }),
    )

    const response = await DELETE(new NextRequest("http://localhost/api/booking/slot_1"), context())

    expect(response.status).toBe(404)
  })

  it("moves an owned slot", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.prisma.bookingTimeSlot.findUnique.mockResolvedValue(ownedSlot())
    mocks.prisma.bookingTimeSlot.update.mockResolvedValue({ id: "slot_1", bookingGroupId: "group_1" })

    const response = await PATCH(
      request({
        action: "move",
        start: "2026-06-10T03:00:00.000Z",
        end: "2026-06-10T04:00:00.000Z",
      }),
      context(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      action: "move",
      bookingId: "slot_1",
      bookingGroupId: "group_1",
    })
  })

  it("copies an owned slot", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.prisma.bookingTimeSlot.findUnique.mockResolvedValue(ownedSlot())
    mocks.prisma.bookingTimeSlot.create.mockResolvedValue({ id: "slot_copy", bookingGroupId: "group_1" })

    const response = await PATCH(
      request({
        action: "copy",
        start: "2026-06-10T03:00:00.000Z",
        end: "2026-06-10T04:00:00.000Z",
      }),
      context(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      action: "copy",
      bookingId: "slot_copy",
      bookingGroupId: "group_1",
    })
  })

  it("rejects invalid move/copy payloads", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.prisma.bookingTimeSlot.findUnique.mockResolvedValue(ownedSlot())

    const response = await PATCH(
      request({
        action: "move",
        start: "2026-06-10T04:00:00.000Z",
        end: "2026-06-10T03:00:00.000Z",
      }),
      context(),
    )

    expect(response.status).toBe(400)
  })
})
