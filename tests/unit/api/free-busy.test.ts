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
vi.mock("@/lib/booking/team-access", () => ({
  listTeamMemberUserIds: mocks.listTeamMemberUserIds,
}))
vi.mock("@/lib/google-calendar", () => ({
  CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
  CalendarOAuthEnvMissingError: mocks.CalendarOAuthEnvMissingError,
  CalendarTokenRevokedError: mocks.CalendarTokenRevokedError,
  listBusyEventsWithBuffer: mocks.listBusyEventsWithBuffer,
  refreshCalendarAccessToken: mocks.refreshCalendarAccessToken,
}))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import { GET } from "@/app/api/calendar/free-busy/route"

function request(teamId?: string) {
  const url = new URL("http://localhost/api/calendar/free-busy")
  url.searchParams.set("start", "2026-06-01T00:00:00.000Z")
  url.searchParams.set("end", "2026-06-30T00:00:00.000Z")
  if (teamId) url.searchParams.set("teamId", teamId)
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
    },
  ])
}

describe("GET /api/calendar/free-busy", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
