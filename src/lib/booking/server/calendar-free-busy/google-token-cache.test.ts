import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  CalendarTokenRevokedError: class MockCalendarTokenRevokedError extends Error {
    code = "calendar_token_revoked" as const
  },
  refreshCalendarAccessToken: vi.fn(),
  prisma: {
    calendarToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/google-calendar/server", () => ({
  CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
  CalendarTokenRevokedError: mocks.CalendarTokenRevokedError,
  refreshCalendarAccessToken: mocks.refreshCalendarAccessToken,
}))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import {
  clearCalendarAccessTokenCacheForTest,
  getCachedCalendarAccessToken,
} from "./google-token-cache"

describe("getCachedCalendarAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCalendarAccessTokenCacheForTest()
    mocks.prisma.calendarToken.findUnique.mockResolvedValue({ refreshToken: "refresh_token" })
  })

  it("logs revoked refresh tokens and rethrows the original error", async () => {
    const error = new mocks.CalendarTokenRevokedError()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.refreshCalendarAccessToken.mockRejectedValue(error)

    await expect(getCachedCalendarAccessToken("user_1")).rejects.toBe(error)

    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("[calendar-token-cache]"))
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("code=calendar_token_revoked"))
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("cacheUserId=user_1"))
    consoleError.mockRestore()
  })
})
