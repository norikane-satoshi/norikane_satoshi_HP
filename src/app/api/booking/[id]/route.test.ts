import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

type Session = {
  user?: {
    id?: string
    email?: string | null
  } | null
} | null

type SlotInput = {
  customerUserId?: string
  teamMemberUserIds?: string[]
  startTime?: Date
  gcalEventId?: string | null
}

const ORIGINAL_ENV = { ...process.env }
const FUTURE_START = new Date("2099-05-18T01:00:00.000Z")
const FUTURE_END = new Date("2099-05-18T02:00:00.000Z")
const PAST_START = new Date("2020-05-18T01:00:00.000Z")
const PAST_END = new Date("2020-05-18T02:00:00.000Z")

function createSlot(input: SlotInput = {}) {
  const startTime = input.startTime ?? FUTURE_START
  const endTime = startTime === PAST_START ? PAST_END : FUTURE_END
  return {
    id: "slot_1",
    bookingGroupId: "group_1",
    bookingGroup: {
      id: "group_1",
      projectTitle: "Original Project",
      contactName: "Original Name",
      contactEmail: "old@example.com",
      phone: null,
      companyName: "Original Company",
      memo: "Original Memo",
      dueDate: "2099-06-01",
      teamId: "team_1",
      status: "CONFIRMED",
      gcalEventId: "gcalEventId" in input ? input.gcalEventId : "gcal_1",
      bufferBeforeHours: 1,
      bufferAfterHours: 1,
      customer: {
        userId: input.customerUserId ?? "owner_user",
      },
      team: {
        members: (input.teamMemberUserIds ?? []).map((userId) => ({ userId })),
      },
      timeSlots: [
        {
          id: "slot_1",
          startTime,
          endTime,
          status: "CONFIRMED",
        },
      ],
    },
  }
}

function request(method: string, path = "/api/booking/slot_1", body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  })
}

type LoadRouteOptions = {
  updateCalendarEventImpl?: (...args: unknown[]) => Promise<unknown>
}

async function loadRoute(
  session: Session,
  slot: ReturnType<typeof createSlot> | null,
  options: LoadRouteOptions = {},
) {
  vi.resetModules()
  process.env.BOOKING_CALENDAR_ADMIN_EMAIL = "admin@example.com"
  process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID = "calendar_id_test"

  const auth = vi.fn().mockResolvedValue(session)
  const deleteCalendarEvent = vi.fn().mockResolvedValue(undefined)
  const updateCalendarEvent = options.updateCalendarEventImpl
    ? vi.fn().mockImplementation(options.updateCalendarEventImpl)
    : vi.fn().mockResolvedValue(undefined)
  const getCachedCalendarAccessToken = vi.fn().mockResolvedValue({ token: "access_token", refreshMs: 0 })
  const findConflictingBookings = vi.fn().mockResolvedValue([])
  const sendBookingTimeChangedEmail = vi.fn().mockResolvedValue(undefined)
  const prisma = {
    bookingTimeSlot: {
      findUnique: vi.fn().mockResolvedValue(slot),
      update: vi.fn().mockImplementation(({ where, data }) => Promise.resolve({
        id: where.id,
        bookingGroupId: "group_1",
        ...data,
      })),
    },
    bookingGroup: {
      update: vi.fn().mockImplementation(({ where, data }) => Promise.resolve({
        id: where.id,
        bufferBeforeHours: slot?.bookingGroup.bufferBeforeHours ?? 1,
        bufferAfterHours: slot?.bookingGroup.bufferAfterHours ?? 1,
        ...data,
      })),
      delete: vi.fn().mockResolvedValue({ id: "group_1" }),
    },
  }

  vi.doMock("@/auth", () => ({ auth }))
  vi.doMock("@/lib/prisma", () => ({ prisma }))
  vi.doMock("@/lib/google-calendar/server", () => ({
    CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
    deleteCalendarEvent,
    updateCalendarEvent,
  }))
  vi.doMock("@/lib/booking/server/calendar-free-busy/google-token-cache", () => ({
    getCachedCalendarAccessToken,
  }))
  vi.doMock("@/lib/booking/server/conflicts", () => ({ findConflictingBookings }))
  vi.doMock("@/lib/booking/server/email", () => ({ sendBookingTimeChangedEmail }))

  const route = await import("./route")
  return { ...route, prisma, deleteCalendarEvent, updateCalendarEvent, getCachedCalendarAccessToken, findConflictingBookings, sendBookingTimeChangedEmail }
}

function context(id = "slot_1") {
  return { params: Promise.resolve({ id }) }
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.resetModules()
  vi.clearAllMocks()
})

describe("/api/booking/[id] access control", () => {
  it("returns 404 for another user's booking on GET/PATCH/DELETE", async () => {
    const route = await loadRoute(
      { user: { id: "other_user", email: "other@example.com" } },
      createSlot({ customerUserId: "owner_user", teamMemberUserIds: [] }),
    )

    expect((await route.GET(request("GET"), context())).status).toBe(404)
    expect((await route.PATCH(request("PATCH", "/api/booking/slot_1", { action: "update_details", memo: "x" }), context())).status).toBe(404)
    expect((await route.DELETE(request("DELETE"), context())).status).toBe(404)
  })

  it("allows team members to GET but rejects PATCH and DELETE", async () => {
    const route = await loadRoute(
      { user: { id: "team_user", email: "team@example.com" } },
      createSlot({ customerUserId: "owner_user", teamMemberUserIds: ["team_user"] }),
    )

    expect((await route.GET(request("GET"), context())).status).toBe(200)
    expect((await route.PATCH(request("PATCH", "/api/booking/slot_1", { action: "update_details", memo: "x" }), context())).status).toBe(403)
    expect((await route.DELETE(request("DELETE"), context())).status).toBe(403)
  })

  it("allows admins to GET, PATCH, and DELETE another user's booking", async () => {
    const route = await loadRoute(
      { user: { id: "admin_user", email: "admin@example.com" } },
      createSlot({ customerUserId: "owner_user", teamMemberUserIds: [] }),
    )

    expect((await route.GET(request("GET"), context())).status).toBe(200)
    expect((await route.PATCH(request("PATCH", "/api/booking/slot_1", { action: "update_details", memo: "admin memo" }), context())).status).toBe(200)
    expect((await route.DELETE(request("DELETE"), context())).status).toBe(200)
  })

  it("hard deletes bookingGroup for admin DELETE mode=hard", async () => {
    const route = await loadRoute(
      { user: { id: "admin_user", email: "admin@example.com" } },
      createSlot({ customerUserId: "owner_user" }),
    )

    const response = await route.DELETE(request("DELETE", "/api/booking/slot_1?mode=hard"), context())

    expect(response.status).toBe(200)
    expect(route.deleteCalendarEvent).toHaveBeenCalledWith("gcal_1")
    expect(route.prisma.bookingGroup.delete).toHaveBeenCalledWith({ where: { id: "group_1" } })
  })

  it("locks PATCH and DELETE for past bookings when the user is not admin", async () => {
    const route = await loadRoute(
      { user: { id: "owner_user", email: "owner@example.com" } },
      createSlot({ customerUserId: "owner_user", startTime: PAST_START }),
    )

    const patch = await route.PATCH(request("PATCH", "/api/booking/slot_1", { action: "update_details", memo: "past" }), context())
    const patchPayload = await patch.json()
    const del = await route.DELETE(request("DELETE"), context())
    const deletePayload = await del.json()

    expect(patch.status).toBe(403)
    expect(patchPayload.error).toBe("past_booking_locked")
    expect(del.status).toBe(403)
    expect(deletePayload.error).toBe("past_booking_locked")
  })

  it("allows admins to PATCH and DELETE past bookings", async () => {
    const route = await loadRoute(
      { user: { id: "admin_user", email: "admin@example.com" } },
      createSlot({ customerUserId: "owner_user", startTime: PAST_START }),
    )

    expect((await route.PATCH(request("PATCH", "/api/booking/slot_1", { action: "update_details", memo: "past admin" }), context())).status).toBe(200)
    expect((await route.DELETE(request("DELETE"), context())).status).toBe(200)
  })

  it("updates bookingGroup details with PATCH action=update_details", async () => {
    const route = await loadRoute(
      { user: { id: "owner_user", email: "owner@example.com" } },
      createSlot({ customerUserId: "owner_user" }),
    )

    const response = await route.PATCH(request("PATCH", "/api/booking/slot_1", {
      action: "update_details",
      projectTitle: "Updated Project",
      contactName: "Updated Name",
      memo: "Updated Memo",
    }), context())

    expect(response.status).toBe(200)
    expect(route.prisma.bookingGroup.update).toHaveBeenCalledWith({
      where: { id: "group_1" },
      data: {
        projectTitle: "Updated Project",
        contactName: "Updated Name",
        memo: "Updated Memo",
      },
    })
  })

  it("PATCH action=move updates GCal then DB when gcalEventId is set", async () => {
    const route = await loadRoute(
      { user: { id: "owner_user", email: "owner@example.com" } },
      createSlot({ customerUserId: "owner_user", gcalEventId: "gcal_evt_1" }),
    )

    const response = await route.PATCH(
      request("PATCH", "/api/booking/slot_1", {
        action: "move",
        start: "2099-05-18T02:00:00.000Z",
        end: "2099-05-18T03:30:00.000Z",
      }),
      context(),
    )

    expect(response.status).toBe(200)
    expect(route.getCachedCalendarAccessToken).toHaveBeenCalledWith("satoshi-calendar-owner")
    expect(route.updateCalendarEvent).toHaveBeenCalledWith({
      calendarId: "calendar_id_test",
      eventId: "gcal_evt_1",
      accessToken: "access_token",
      start: "2099-05-18T02:00:00.000Z",
      end: "2099-05-18T03:30:00.000Z",
    })
    expect(route.prisma.bookingTimeSlot.update).toHaveBeenCalledWith({
      where: { id: "slot_1" },
      data: {
        startTime: new Date("2099-05-18T02:00:00.000Z"),
        endTime: new Date("2099-05-18T03:30:00.000Z"),
      },
    })
  })

  it("PATCH action=move returns 502 and does not update DB when GCal update fails", async () => {
    const route = await loadRoute(
      { user: { id: "owner_user", email: "owner@example.com" } },
      createSlot({ customerUserId: "owner_user", gcalEventId: "gcal_evt_1" }),
      { updateCalendarEventImpl: () => Promise.reject(new Error("gcal_down")) },
    )

    const response = await route.PATCH(
      request("PATCH", "/api/booking/slot_1", {
        action: "move",
        start: "2099-05-18T02:00:00.000Z",
        end: "2099-05-18T03:30:00.000Z",
      }),
      context(),
    )
    const payload = await response.json()

    expect(response.status).toBe(502)
    expect(payload.error).toBe("calendar_update_failed")
    expect(route.updateCalendarEvent).toHaveBeenCalledTimes(1)
    expect(route.prisma.bookingTimeSlot.update).not.toHaveBeenCalled()
  })

  it("PATCH action=move skips GCal update when gcalEventId is null", async () => {
    const route = await loadRoute(
      { user: { id: "owner_user", email: "owner@example.com" } },
      createSlot({ customerUserId: "owner_user", gcalEventId: null }),
    )

    const response = await route.PATCH(
      request("PATCH", "/api/booking/slot_1", {
        action: "move",
        start: "2099-05-18T02:00:00.000Z",
        end: "2099-05-18T03:30:00.000Z",
      }),
      context(),
    )

    expect(response.status).toBe(200)
    expect(route.updateCalendarEvent).not.toHaveBeenCalled()
    expect(route.getCachedCalendarAccessToken).not.toHaveBeenCalled()
    expect(route.prisma.bookingTimeSlot.update).toHaveBeenCalledWith({
      where: { id: "slot_1" },
      data: {
        startTime: new Date("2099-05-18T02:00:00.000Z"),
        endTime: new Date("2099-05-18T03:30:00.000Z"),
      },
    })
  })

  it("PATCH action=resize_buffer updates before buffer for admins", async () => {
    const route = await loadRoute(
      { user: { id: "admin_user", email: "admin@example.com" } },
      createSlot({ customerUserId: "owner_user", gcalEventId: "gcal_evt_1" }),
    )

    const response = await route.PATCH(
      request("PATCH", "/api/booking/slot_1", {
        action: "resize_buffer",
        side: "before",
        hours: 0.5,
      }),
      context(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      action: "resize_buffer",
      bookingGroupId: "group_1",
      side: "before",
      hours: 0.5,
    })
    expect(route.prisma.bookingGroup.update).toHaveBeenCalledWith({
      where: { id: "group_1" },
      data: { bufferBeforeHours: 0.5 },
    })
    expect(route.findConflictingBookings).toHaveBeenCalledWith(
      new Date("2099-05-18T00:30:00.000Z"),
      FUTURE_START,
      { excludeBookingId: "slot_1" },
    )
    expect(route.getCachedCalendarAccessToken).toHaveBeenCalledWith("satoshi-calendar-owner")
    expect(route.updateCalendarEvent).toHaveBeenCalledWith({
      calendarId: "calendar_id_test",
      eventId: "gcal_evt_1",
      accessToken: "access_token",
      start: FUTURE_START.toISOString(),
      end: FUTURE_END.toISOString(),
      bufferBeforeHours: 0.5,
      bufferAfterHours: 1,
    })
    expect(route.sendBookingTimeChangedEmail).not.toHaveBeenCalled()
  })

  it("PATCH action=resize_buffer rejects owners", async () => {
    const route = await loadRoute(
      { user: { id: "owner_user", email: "owner@example.com" } },
      createSlot({ customerUserId: "owner_user" }),
    )

    const response = await route.PATCH(
      request("PATCH", "/api/booking/slot_1", {
        action: "resize_buffer",
        side: "before",
        hours: 0.5,
      }),
      context(),
    )

    expect(response.status).toBe(403)
    expect(route.prisma.bookingGroup.update).not.toHaveBeenCalled()
  })

  it("PATCH action=resize_buffer rejects negative hours", async () => {
    const route = await loadRoute(
      { user: { id: "admin_user", email: "admin@example.com" } },
      createSlot({ customerUserId: "owner_user" }),
    )

    const response = await route.PATCH(
      request("PATCH", "/api/booking/slot_1", {
        action: "resize_buffer",
        side: "before",
        hours: -1,
      }),
      context(),
    )

    expect(response.status).toBe(400)
    expect(route.prisma.bookingGroup.update).not.toHaveBeenCalled()
  })

  it("PATCH action=resize_buffer rejects invalid side", async () => {
    const route = await loadRoute(
      { user: { id: "admin_user", email: "admin@example.com" } },
      createSlot({ customerUserId: "owner_user" }),
    )

    const response = await route.PATCH(
      request("PATCH", "/api/booking/slot_1", {
        action: "resize_buffer",
        side: "invalid",
        hours: 0.5,
      }),
      context(),
    )

    expect(response.status).toBe(400)
    expect(route.prisma.bookingGroup.update).not.toHaveBeenCalled()
  })

  it("PATCH action=resize_buffer rejects overlaps with confirmed bookings", async () => {
    const route = await loadRoute(
      { user: { id: "admin_user", email: "admin@example.com" } },
      createSlot({ customerUserId: "owner_user" }),
    )
    route.findConflictingBookings.mockResolvedValue([{ id: "slot_busy" }])

    const response = await route.PATCH(
      request("PATCH", "/api/booking/slot_1", {
        action: "resize_buffer",
        side: "after",
        hours: 1,
      }),
      context(),
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "slot_taken" })
    expect(route.prisma.bookingGroup.update).not.toHaveBeenCalled()
    expect(route.updateCalendarEvent).not.toHaveBeenCalled()
  })
})
