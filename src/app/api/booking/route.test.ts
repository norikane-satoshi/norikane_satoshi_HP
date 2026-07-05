import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

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

function conflictSlot(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-10T00:00:00.000Z")
  return {
    id: "slot_busy",
    bookingGroupId: "group_busy",
    startTime: new Date("2026-06-10T01:00:00.000Z"),
    endTime: new Date("2026-06-10T02:00:00.000Z"),
    previousStartTime: null,
    previousEndTime: null,
    status: "CONFIRMED",
    createdAt: now,
    updatedAt: now,
    bookingGroup: {
      id: "group_busy",
      customerId: "customer_busy",
      teamId: null,
      status: "CONFIRMED",
      pendingExpiresAt: null,
      projectTitle: "Busy",
      memo: null,
      contactName: "Busy",
      companyName: null,
      customerEmail: "busy@example.com",
      phone: null,
      dueDate: null,
      bufferBeforeHours: 1,
      bufferAfterHours: 1,
      gcalEventId: null,
      notionPageId: null,
      createdAt: now,
      updatedAt: now,
      customer: {
        displayName: "Busy",
        user: { email: "busy@example.com" },
      },
    },
    ...overrides,
  }
}

async function loadPost() {
  vi.resetModules()
  vi.stubEnv("GOOGLE_CALENDAR_BUSY_SOURCE_ID", "calendar_1")

  const auth = vi.fn().mockResolvedValue({
    user: { id: "user_1", email: "satoshi@example.com" },
  })
  const isTeamMember = vi.fn().mockResolvedValue(true)
  const invalidateCalendarFreeBusyCacheForUser = vi.fn()
  const sendBookingConfirmedEmail = vi.fn().mockResolvedValue({ skipped: true })
  const refreshCalendarAccessToken = vi.fn().mockResolvedValue({
    accessToken: "access_token",
    expiresAt: new Date("2026-06-10T00:00:00.000Z"),
    scope: "scope",
  })
  const createCalendarEvent = vi.fn().mockResolvedValue({ id: "gcal_1" })
  const prisma = {
    $transaction: vi.fn((callback) => callback(prisma)),
    customer: {
      upsert: vi.fn().mockResolvedValue({ id: "customer_1" }),
    },
    bookingTimeSlot: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingGroup: {
      create: vi.fn().mockResolvedValue({
        id: "clwxyz123abc",
        timeSlots: [{ id: "slot_1" }],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    calendarToken: {
      findUnique: vi.fn().mockResolvedValue({ refreshToken: "refresh_token" }),
      update: vi.fn().mockResolvedValue({}),
    },
    adminActionLog: {
      create: vi.fn().mockResolvedValue({ id: "log_1" }),
    },
  }

  vi.doMock("@/auth", () => ({ auth }))
  vi.doMock("@/lib/booking/server/team-access", () => ({ isTeamMember }))
  vi.doMock("@/lib/booking/server/calendar-free-busy/free-busy", () => ({
    invalidateCalendarFreeBusyCacheForUser,
  }))
  vi.doMock("@/lib/booking/server/email", () => ({ sendBookingConfirmedEmail }))
  vi.doMock("@/lib/google-calendar/server", () => ({
    CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
    createCalendarEvent,
    refreshCalendarAccessToken,
  }))
  vi.doMock("@/lib/prisma", () => ({ prisma }))

  const route = await import("./route")
  return {
    POST: route.POST,
    prisma,
    createCalendarEvent,
    invalidateCalendarFreeBusyCacheForUser,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.clearAllMocks()
})

describe("POST /api/booking Saga", () => {
  it("confirms without conflict and passes a sanitized Google Calendar event id", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validBooking()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      bookingGroupId: "clwxyz123abc",
      bookingIds: ["slot_1"],
      bookingStatus: "CONFIRMED",
    })
    expect(route.createCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "cl123abc",
      }),
    )
  })

  it("returns 409 for a conflict without creating a pending bookingGroup", async () => {
    const route = await loadPost()
    route.prisma.bookingTimeSlot.findMany.mockResolvedValue([conflictSlot()])

    const response = await route.POST(request(validBooking()))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "slot_taken" })
    expect(route.prisma.bookingGroup.create).not.toHaveBeenCalled()
  })

  it("accepts requested date arrays and creates a transparent all-day Google Calendar hold", async () => {
    const route = await loadPost()
    route.prisma.bookingGroup.create.mockResolvedValueOnce({
      id: "clwxyz123abc",
      timeSlots: [],
    })

    const response = await route.POST(request(validBooking({
      selectedSlots: [],
      requestedDates: ["2026-07-10", "2026-07-12"],
    })))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: "schedule_unselected",
      bookingGroupId: "clwxyz123abc",
      bookingIds: [],
      bookingStatus: "NEEDS_SCHEDULE",
      scheduleStatus: "unscheduled",
    })
    expect(route.createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "cl123abc",
      summary: "【仮キープ】Color grading / Satoshi",
      start: "2026-07-10",
      end: "2026-07-11",
      colorId: "4",
      notionTaskType: "仮押さえ",
      dateOnly: true,
      transparency: "transparent",
    }))
    expect(route.prisma.bookingGroup.update).toHaveBeenCalledWith({
      where: { id: "clwxyz123abc" },
      data: { gcalEventId: "gcal_1" },
    })
    expect(route.prisma.bookingGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "NEEDS_SCHEDULE",
          pendingExpiresAt: null,
          timeSlots: { create: [] },
        }),
      }),
    )
  })

  it("marks bookingGroup and timeSlots FAILED when Google Calendar fails twice", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const route = await loadPost()
    route.createCalendarEvent.mockRejectedValue(new Error("gcal down"))

    const response = await route.POST(request(validBooking()))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: "calendar_unavailable",
      bookingGroupId: "clwxyz123abc",
    })
    expect(route.createCalendarEvent).toHaveBeenCalledTimes(2)
    expect(route.prisma.bookingGroup.update).toHaveBeenCalledWith({
      where: { id: "clwxyz123abc" },
      data: { status: "FAILED", pendingExpiresAt: null },
    })
    expect(route.prisma.bookingTimeSlot.updateMany).toHaveBeenCalledWith({
      where: { bookingGroupId: "clwxyz123abc" },
      data: { status: "FAILED" },
    })
    warn.mockRestore()
  })

  it("returns pending_reconcile and logs AdminActionLog when DB confirm fails after GCal success", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const route = await loadPost()
    route.prisma.bookingGroup.update.mockRejectedValue(new Error("db down"))

    const response = await route.POST(request(validBooking()))

    expect(response.status).toBe(202)
    expect(response.headers.get("Retry-After")).toBe("60")
    await expect(response.json()).resolves.toEqual({
      status: "pending_reconcile",
      bookingGroupId: "clwxyz123abc",
      gcalEventId: "gcal_1",
    })
    expect(route.prisma.adminActionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorEmail: "satoshi@example.com",
          action: "GCAL_OK_DB_CONFIRM_FAILED",
        }),
      }),
    )
    error.mockRestore()
  })

  it("allows a new booking when an old PENDING_GCAL hold has expired", async () => {
    const route = await loadPost()
    route.prisma.bookingTimeSlot.findMany.mockResolvedValue([
      conflictSlot({
        status: "PENDING_GCAL",
        bookingGroup: {
          ...conflictSlot().bookingGroup,
          status: "PENDING_GCAL",
          pendingExpiresAt: new Date("2026-05-19T00:00:00.000Z"),
        },
      }),
    ])

    const response = await route.POST(request(validBooking()))

    expect(response.status).toBe(200)
    expect(route.prisma.bookingGroup.create).toHaveBeenCalled()
  })
})
