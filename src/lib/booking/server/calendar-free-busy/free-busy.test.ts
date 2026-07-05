import { beforeEach, describe, expect, it, vi } from "vitest"

describe("getCalendarFreeBusyForUser dedupe (B)", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("dedupes a booking (UTC Z) and a busy slot (JST +09:00) representing the same instant", async () => {
    class FakeCalendarOAuthEnvMissingError extends Error {
      code = "calendar_oauth_env_missing" as const
    }
    class FakeCalendarTokenRevokedError extends Error {
      code = "calendar_token_revoked" as const
    }

    const listBusyEventsWithBufferMock = vi.fn().mockResolvedValue([
      {
        start: "2026-05-18T10:00:00+09:00",
        end: "2026-05-18T11:00:00+09:00",
        bufferHours: null,
      },
    ])

    vi.doMock("@/lib/google-calendar/server", () => ({
      CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
      CalendarOAuthEnvMissingError: FakeCalendarOAuthEnvMissingError,
      CalendarTokenRevokedError: FakeCalendarTokenRevokedError,
      listBusyEventsWithBuffer: listBusyEventsWithBufferMock,
    }))

    vi.doMock("./bookings-repository", () => ({
      listAllBookings: vi.fn(),
      listBookings: vi.fn().mockResolvedValue([
        {
          id: "booking_1",
          bookingGroupId: "group_1",
          customerUserId: "user_1",
          start: "2026-05-18T01:00:00.000Z",
          end: "2026-05-18T02:00:00.000Z",
          title: "test booking",
          status: "CONFIRMED",
        },
      ]),
    }))

    vi.doMock("./google-token-cache", () => ({
      clearCalendarAccessTokenCacheForTest: vi.fn(),
      getCachedCalendarAccessToken: vi.fn().mockResolvedValue({ token: "access_token", refreshMs: 0 }),
    }))

    vi.doMock("@/lib/booking/server/team-access", () => ({
      listTeamMemberUserIds: vi.fn().mockResolvedValue(["user_1"]),
    }))

    vi.doMock("@/lib/prisma", () => ({ prisma: {} }))
    vi.doMock("@/lib/chatbot/server/notion-work-schedule-busy", () => ({
      getNotionWorkScheduleBusyIntervals: vi.fn().mockResolvedValue([]),
    }))

    const { getCalendarFreeBusyForUser } = await import("./free-busy")
    const result = await getCalendarFreeBusyForUser({
      userId: "user_1",
      teamId: null,
      timeMin: "2026-05-18T00:00:00Z",
      timeMax: "2026-05-19T00:00:00Z",
      calendarId: "calendar_id",
      useCache: false,
    })

    expect(result.busy).toHaveLength(0)
    expect(result.bookings).toHaveLength(1)
    expect(result.bookings[0]).toMatchObject({
      start: "2026-05-18T01:00:00.000Z",
      end: "2026-05-18T02:00:00.000Z",
    })
  })

  it("keeps a busy slot that does not match any booking (other user's HP event stays visible)", async () => {
    class FakeCalendarOAuthEnvMissingError extends Error {
      code = "calendar_oauth_env_missing" as const
    }
    class FakeCalendarTokenRevokedError extends Error {
      code = "calendar_token_revoked" as const
    }

    const listBusyEventsWithBufferMock = vi.fn().mockResolvedValue([
      {
        start: "2026-05-18T10:00:00+09:00",
        end: "2026-05-18T11:00:00+09:00",
        bufferHours: null,
      },
      {
        start: "2026-05-18T15:00:00+09:00",
        end: "2026-05-18T16:00:00+09:00",
        bufferHours: null,
      },
    ])

    vi.doMock("@/lib/google-calendar/server", () => ({
      CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
      CalendarOAuthEnvMissingError: FakeCalendarOAuthEnvMissingError,
      CalendarTokenRevokedError: FakeCalendarTokenRevokedError,
      listBusyEventsWithBuffer: listBusyEventsWithBufferMock,
    }))

    vi.doMock("./bookings-repository", () => ({
      listAllBookings: vi.fn(),
      listBookings: vi.fn().mockResolvedValue([
        {
          id: "booking_1",
          bookingGroupId: "group_1",
          customerUserId: "user_1",
          start: "2026-05-18T01:00:00.000Z",
          end: "2026-05-18T02:00:00.000Z",
          title: "test booking",
          status: "CONFIRMED",
        },
      ]),
    }))

    vi.doMock("./google-token-cache", () => ({
      clearCalendarAccessTokenCacheForTest: vi.fn(),
      getCachedCalendarAccessToken: vi.fn().mockResolvedValue({ token: "access_token", refreshMs: 0 }),
    }))

    vi.doMock("@/lib/booking/server/team-access", () => ({
      listTeamMemberUserIds: vi.fn().mockResolvedValue(["user_1"]),
    }))

    vi.doMock("@/lib/prisma", () => ({ prisma: {} }))
    vi.doMock("@/lib/chatbot/server/notion-work-schedule-busy", () => ({
      getNotionWorkScheduleBusyIntervals: vi.fn().mockResolvedValue([]),
    }))

    const { getCalendarFreeBusyForUser } = await import("./free-busy")
    const result = await getCalendarFreeBusyForUser({
      userId: "user_1",
      teamId: null,
      timeMin: "2026-05-18T00:00:00Z",
      timeMax: "2026-05-19T00:00:00Z",
      calendarId: "calendar_id",
      useCache: false,
    })

    expect(result.busy).toHaveLength(1)
    expect(result.bookings).toHaveLength(1)
    expect(result.busy[0].start).toBe("2026-05-18T15:00:00+09:00")
  })
})
