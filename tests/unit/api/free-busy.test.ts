import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  CalendarOAuthEnvMissingError: class MockCalendarOAuthEnvMissingError extends Error {
    code = "calendar_oauth_env_missing" as const
  },
  CalendarTokenRevokedError: class MockCalendarTokenRevokedError extends Error {
    code = "calendar_token_revoked" as const
  },
  auth: vi.fn(),
  listTeamMemberUserIds: vi.fn(),
  listBusyEventsWithBuffer: vi.fn(),
  refreshCalendarAccessToken: vi.fn(),
  prisma: {
    bookingTimeSlot: {
      findMany: vi.fn(),
    },
    calendarToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/booking/server/team-access", () => ({
  listTeamMemberUserIds: mocks.listTeamMemberUserIds,
}))
vi.mock("@/lib/google-calendar/server", () => ({
  CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
  CalendarOAuthEnvMissingError: mocks.CalendarOAuthEnvMissingError,
  CalendarTokenRevokedError: mocks.CalendarTokenRevokedError,
  listBusyEventsWithBuffer: mocks.listBusyEventsWithBuffer,
  refreshCalendarAccessToken: mocks.refreshCalendarAccessToken,
}))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import { GET } from "@/app/api/calendar/free-busy/route"
import {
  calendarErrorStatus,
  clearCalendarFreeBusyCachesForTest,
  getCalendarFreeBusyForUser,
  invalidateCalendarFreeBusyCacheForUser,
} from "@/lib/booking/server/calendar-free-busy/free-busy"

function request(teamId?: string, refresh?: string) {
  const url = new URL("http://localhost/api/calendar/free-busy")
  url.searchParams.set("start", "2026-06-01T00:00:00.000Z")
  url.searchParams.set("end", "2026-06-30T00:00:00.000Z")
  if (teamId) url.searchParams.set("teamId", teamId)
  if (refresh) url.searchParams.set("refresh", refresh)
  return new NextRequest(url)
}

function mockCalendar() {
  process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID = "calendar_1"
  mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
  mocks.prisma.bookingTimeSlot.findMany.mockResolvedValue([])
  mocks.prisma.calendarToken.findUnique.mockResolvedValue({ refreshToken: "refresh_token" })
  mocks.refreshCalendarAccessToken.mockResolvedValue({
    accessToken: "access_token",
    expiresAt: new Date("2026-06-01T00:00:00.000Z"),
    scope: "scope",
  })
  mocks.prisma.calendarToken.update.mockResolvedValue({})
  mocks.listBusyEventsWithBuffer.mockResolvedValue([
    {
      start: "2026-06-10T01:00:00.000Z",
      end: "2026-06-10T02:00:00.000Z",
      bufferHours: 1,
      bufferBeforeHours: null,
      bufferAfterHours: null,
      summary: null,
    },
  ])
}

function mockBookingRows() {
  mocks.prisma.bookingTimeSlot.findMany.mockResolvedValue([
    {
      id: "slot_1",
      bookingGroupId: "group_1",
      startTime: new Date("2026-06-12T01:00:00.000Z"),
      endTime: new Date("2026-06-12T02:00:00.000Z"),
      status: "CONFIRMED",
      bookingGroup: {
        projectTitle: "Existing booking",
        status: "CONFIRMED",
        bufferBeforeHours: 1,
        bufferAfterHours: 1,
        customer: { userId: "user_1" },
      },
    },
  ])
}

describe("GET /api/calendar/free-busy", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCalendarFreeBusyCachesForTest()
    delete process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
  })

  it("queries only the session user's bookings when teamId is absent", async () => {
    mockCalendar()

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(mocks.prisma.bookingTimeSlot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bookingGroup: {
            customer: {
              userId: { in: ["user_1"] },
            },
          },
        }),
      }),
    )
    expect(mocks.listBusyEventsWithBuffer).toHaveBeenCalledWith(
      "calendar_1",
      "2026-06-01T00:00:00.000Z",
      "2026-06-30T00:00:00.000Z",
      "access_token",
    )
    expect(response.headers.get("cache-control")).toBe("private, max-age=15, stale-while-revalidate=60")
  })

  it("returns 401 for unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
  })

  it("validates missing and invalid time bounds", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })

    const missing = await GET(new NextRequest("http://localhost/api/calendar/free-busy"))
    expect(missing.status).toBe(400)
    await expect(missing.json()).resolves.toEqual({ error: "Missing timeMin or timeMax" })

    const invalidUrl = new URL("http://localhost/api/calendar/free-busy")
    invalidUrl.searchParams.set("start", "bad")
    invalidUrl.searchParams.set("end", "2026-06-30T00:00:00.000Z")
    const invalid = await GET(new NextRequest(invalidUrl))
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toEqual({ error: "Invalid timeMin or timeMax" })
  })

  it("queries team member bookings when teamId is present", async () => {
    mockCalendar()
    mocks.listTeamMemberUserIds.mockResolvedValue(["user_1", "user_2"])

    const response = await GET(request("team_1"))

    expect(response.status).toBe(200)
    expect(mocks.listTeamMemberUserIds).toHaveBeenCalledWith("user_1", "team_1")
    expect(mocks.prisma.bookingTimeSlot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bookingGroup: {
            customer: {
              userId: { in: ["user_1", "user_2"] },
            },
          },
        }),
      }),
    )
  })

  it("serves duplicate warm requests from the in-memory cache", async () => {
    mockCalendar()

    const first = await GET(request())
    const second = await GET(request())

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(mocks.prisma.bookingTimeSlot.findMany).toHaveBeenCalledTimes(1)
    expect(mocks.refreshCalendarAccessToken).toHaveBeenCalledTimes(1)
    expect(mocks.listBusyEventsWithBuffer).toHaveBeenCalledTimes(1)
    expect(second.headers.get("server-timing")).toContain('cache;desc="hit"')
  })

  it("bypasses the in-memory cache when refresh nonce is present", async () => {
    mockCalendar()

    const first = await GET(request())
    const second = await GET(request(undefined, "nonce_1"))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(mocks.prisma.bookingTimeSlot.findMany).toHaveBeenCalledTimes(2)
    expect(mocks.listBusyEventsWithBuffer).toHaveBeenCalledTimes(2)
    expect(second.headers.get("server-timing")).toContain('cache;desc="bypass"')
  })

  it("re-fetches after the user cache is invalidated", async () => {
    mockCalendar()

    await GET(request())
    invalidateCalendarFreeBusyCacheForUser("user_1")
    await GET(request())

    expect(mocks.prisma.bookingTimeSlot.findMany).toHaveBeenCalledTimes(2)
    expect(mocks.refreshCalendarAccessToken).toHaveBeenCalledTimes(1)
    expect(mocks.listBusyEventsWithBuffer).toHaveBeenCalledTimes(2)
  })

  it("returns 404 when the team is not available to the user", async () => {
    mockCalendar()
    mocks.listTeamMemberUserIds.mockResolvedValue(null)

    const response = await GET(request("missing_team"))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "team_not_found" })
  })

  it("returns confirmed bookings with 503 when the calendar id is missing", async () => {
    mockCalendar()
    mockBookingRows()
    delete process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID

    const response = await GET(request())
    const json = await response.json()

    expect(response.status).toBe(503)
    expect(json).toMatchObject({
      code: "calendar_busy_source_missing",
      busy: [],
      bookings: [
        expect.objectContaining({
          id: "slot_1",
          title: "Existing booking",
        }),
      ],
    })
    expect(mocks.refreshCalendarAccessToken).not.toHaveBeenCalled()
  })

  it("returns confirmed bookings when the shared calendar token is not connected", async () => {
    mockCalendar()
    mockBookingRows()
    mocks.prisma.calendarToken.findUnique.mockResolvedValue(null)

    const response = await GET(request())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      code: "calendar_token_not_connected",
      busy: [],
      bookings: [expect.objectContaining({ id: "slot_1" })],
    })
  })

  it("returns known oauth errors with already loaded bookings", async () => {
    mockCalendar()
    mockBookingRows()
    mocks.refreshCalendarAccessToken.mockRejectedValue(new mocks.CalendarOAuthEnvMissingError())

    const response = await GET(request())
    const json = await response.json()

    expect(response.status).toBe(503)
    expect(json).toMatchObject({
      code: "calendar_oauth_env_missing",
      bookings: [expect.objectContaining({ id: "slot_1" })],
    })
  })

  it("returns revoked-token errors raised during event listing", async () => {
    mockCalendar()
    mockBookingRows()
    mocks.listBusyEventsWithBuffer.mockRejectedValue(new mocks.CalendarTokenRevokedError())

    const response = await GET(request())
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json).toMatchObject({
      code: "calendar_token_revoked",
      busy: [],
      bookings: [expect.objectContaining({ id: "slot_1" })],
    })
  })

  it("uses the route fallback for unexpected free-busy failures", async () => {
    mockCalendar()
    mocks.prisma.bookingTimeSlot.findMany.mockRejectedValue(new Error("db down"))

    const response = await GET(request())
    const json = await response.json()

    expect(response.status).toBe(503)
    expect(json).toEqual({
      code: "calendar_free_busy_failed",
      busy: [],
      bookings: [],
    })
  })

  it("supports bypass mode without storing a free-busy cache entry", async () => {
    mockCalendar()

    const first = await getCalendarFreeBusyForUser({
      userId: "user_1",
      teamId: null,
      timeMin: "2026-06-01T00:00:00.000Z",
      timeMax: "2026-06-30T00:00:00.000Z",
      calendarId: "calendar_1",
      useCache: false,
    })
    const second = await getCalendarFreeBusyForUser({
      userId: "user_1",
      teamId: null,
      timeMin: "2026-06-01T00:00:00.000Z",
      timeMax: "2026-06-30T00:00:00.000Z",
      calendarId: "calendar_1",
      useCache: false,
    })

    expect(first.cache).toBe("bypass")
    expect(second.cache).toBe("bypass")
    expect(mocks.prisma.bookingTimeSlot.findMany).toHaveBeenCalledTimes(2)
    expect(mocks.refreshCalendarAccessToken).toHaveBeenCalledTimes(1)
    expect(mocks.listBusyEventsWithBuffer).toHaveBeenCalledTimes(2)
  })

  it("maps calendar errors for route fallback handling", () => {
    expect(calendarErrorStatus(new mocks.CalendarTokenRevokedError())).toEqual({
      code: "calendar_token_revoked",
      status: 401,
    })
    expect(calendarErrorStatus(new mocks.CalendarOAuthEnvMissingError())).toEqual({
      code: "calendar_oauth_env_missing",
      status: 503,
    })
    expect(calendarErrorStatus(new Error("other"))).toEqual({
      code: "calendar_free_busy_failed",
      status: 503,
    })
  })

  it("re-throws unexpected oauth-refresh errors so the route can fall back", async () => {
    mockCalendar()
    mocks.refreshCalendarAccessToken.mockRejectedValue(new Error("oauth network down"))

    await expect(
      getCalendarFreeBusyForUser({
        userId: "user_1",
        teamId: null,
        timeMin: "2026-06-01T00:00:00.000Z",
        timeMax: "2026-06-30T00:00:00.000Z",
        calendarId: "calendar_1",
        useCache: false,
      }),
    ).rejects.toThrow("oauth network down")
  })

  it("re-throws unexpected free-busy errors so the route can fall back", async () => {
    mockCalendar()
    mocks.listBusyEventsWithBuffer.mockRejectedValue(new Error("gcal network down"))

    await expect(
      getCalendarFreeBusyForUser({
        userId: "user_1",
        teamId: null,
        timeMin: "2026-06-01T00:00:00.000Z",
        timeMax: "2026-06-30T00:00:00.000Z",
        calendarId: "calendar_1",
        useCache: false,
      }),
    ).rejects.toThrow("gcal network down")
  })

  it("drops busy events whose start/end exactly match an existing booking", async () => {
    mockCalendar()
    mocks.prisma.bookingTimeSlot.findMany.mockResolvedValue([
      {
        id: "slot_overlap",
        bookingGroupId: "group_overlap",
        startTime: new Date("2026-06-10T01:00:00.000Z"),
        endTime: new Date("2026-06-10T02:00:00.000Z"),
        status: "CONFIRMED",
        bookingGroup: {
          projectTitle: "Overlap",
          status: "CONFIRMED",
          bufferBeforeHours: 1,
          bufferAfterHours: 1,
          customer: { userId: "user_1" },
        },
      },
    ])

    const result = await getCalendarFreeBusyForUser({
      userId: "user_1",
      teamId: null,
      timeMin: "2026-06-01T00:00:00.000Z",
      timeMax: "2026-06-30T00:00:00.000Z",
      calendarId: "calendar_1",
      useCache: false,
    })

    expect(result.status).toBe(200)
    expect(result.busy).toEqual([])
    expect(result.bookings).toEqual([
      expect.objectContaining({ id: "slot_overlap" }),
    ])
  })

  it("invalidates only the matching team-scoped cache entries", async () => {
    mockCalendar()
    mocks.listTeamMemberUserIds.mockResolvedValue(["user_1", "user_2"])

    await GET(request("team_1"))
    invalidateCalendarFreeBusyCacheForUser("user_1", "team_1")
    await GET(request("team_1"))

    expect(mocks.listTeamMemberUserIds).toHaveBeenCalledTimes(2)
    expect(mocks.prisma.bookingTimeSlot.findMany).toHaveBeenCalledTimes(2)
  })

  it("keeps unrelated user caches intact when invalidating without teamId", async () => {
    mockCalendar()
    mocks.listTeamMemberUserIds.mockResolvedValue(["user_1", "user_2"])

    await GET(request("team_1"))
    invalidateCalendarFreeBusyCacheForUser("user_other")
    await GET(request("team_1"))

    expect(mocks.prisma.bookingTimeSlot.findMany).toHaveBeenCalledTimes(1)
  })

  it("invalidates other users' cache entries that share a team id", async () => {
    mockCalendar()
    mocks.listTeamMemberUserIds.mockResolvedValue(["user_1", "user_2"])

    await GET(request("team_1"))
    invalidateCalendarFreeBusyCacheForUser("someone_else", "team_1")
    await GET(request("team_1"))

    expect(mocks.prisma.bookingTimeSlot.findMany).toHaveBeenCalledTimes(2)
  })
})
