import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  CalendarOAuthEnvMissingError: class MockCalendarOAuthEnvMissingError extends Error {
    code = "calendar_oauth_env_missing" as const
  },
  CalendarTokenRevokedError: class MockCalendarTokenRevokedError extends Error {
    code = "calendar_token_revoked" as const
  },
  getCachedCalendarAccessToken: vi.fn(),
  getResendClient: vi.fn(),
  send: vi.fn(),
}))

vi.mock("@/lib/booking/server/calendar-free-busy/google-token-cache", () => ({
  getCachedCalendarAccessToken: mocks.getCachedCalendarAccessToken,
}))
vi.mock("@/lib/booking/server/email", () => ({
  getResendClient: mocks.getResendClient,
}))
vi.mock("@/lib/google-calendar/server", () => ({
  CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
  CalendarOAuthEnvMissingError: mocks.CalendarOAuthEnvMissingError,
  CalendarTokenRevokedError: mocks.CalendarTokenRevokedError,
}))

import { GET } from "./route"

function request(token = "secret") {
  return new NextRequest("http://localhost/api/cron/calendar-health-check", {
    headers: { authorization: `Bearer ${token}` },
  })
}

describe("GET /api/cron/calendar-health-check", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "secret"
    process.env.RESEND_FROM_EMAIL = "noreply@norikane.studio"
    process.env.BOOKING_CALENDAR_ADMIN_EMAIL = "admin@example.com"
    mocks.getResendClient.mockReturnValue({ emails: { send: mocks.send } })
    mocks.send.mockResolvedValue({ data: { id: "email_1" }, error: null })
  })

  it("returns 401 when the bearer token does not match", async () => {
    const response = await GET(request("wrong"))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
    expect(mocks.getCachedCalendarAccessToken).not.toHaveBeenCalled()
  })

  it("returns ok without sending email when the token refresh succeeds", async () => {
    mocks.getCachedCalendarAccessToken.mockResolvedValue({ token: "access_token", refreshMs: 12 })

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, code: "ok" })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("sends an alert and returns calendar_token_revoked when the refresh token is revoked", async () => {
    mocks.getCachedCalendarAccessToken.mockRejectedValue(new mocks.CalendarTokenRevokedError())

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: false, code: "calendar_token_revoked" })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "admin@example.com",
      subject: "[norikane.studio] Calendar OAuth refresh token revoked",
      html: expect.stringContaining("https://norikane.studio/api/calendar/auth"),
    }))
  })

  it("sends an alert and returns calendar_oauth_env_missing when OAuth env is missing", async () => {
    mocks.getCachedCalendarAccessToken.mockRejectedValue(new mocks.CalendarOAuthEnvMissingError())

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: false, code: "calendar_oauth_env_missing" })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "admin@example.com",
      subject: "[norikane.studio] Calendar OAuth env missing",
    }))
  })
})
