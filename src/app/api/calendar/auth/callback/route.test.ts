import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cookies: {
    delete: vi.fn(),
    get: vi.fn(),
  },
  exchangeCalendarCode: vi.fn(),
  prisma: {
    calendarToken: {
      upsert: vi.fn(),
    },
  },
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mocks.cookies),
}))
vi.mock("@/lib/google-calendar/server", () => ({
  CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
  exchangeCalendarCode: mocks.exchangeCalendarCode,
}))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import { GET } from "./route"

function request(search = "?code=code_1&state=state_1") {
  return new NextRequest(`https://norikane.studio/api/calendar/auth/callback${search}`)
}

describe("GET /api/calendar/auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv("BOOKING_CALENDAR_ADMIN_EMAIL", "admin@example.com")
    mocks.cookies.get.mockReturnValue({ value: "state_1" })
    mocks.exchangeCalendarCode.mockResolvedValue({
      accessToken: "access_token",
      refreshToken: "refresh_token",
      expiresAt: new Date("2026-06-28T00:00:00.000Z"),
      scope: "https://www.googleapis.com/auth/calendar",
    })
    mocks.prisma.calendarToken.upsert.mockResolvedValue({})
  })

  it("redirects unauthenticated callback requests to login without bypassing state validation", async () => {
    mocks.auth.mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(
      "https://norikane.studio/login?callbackUrl=%2Fapi%2Fcalendar%2Fauth%2Fcallback%3Fcode%3Dcode_1%26state%3Dstate_1",
    )
    expect(mocks.cookies.get).not.toHaveBeenCalled()
    expect(mocks.exchangeCalendarCode).not.toHaveBeenCalled()
  })

  it("rejects logged-in non-admin users", async () => {
    mocks.auth.mockResolvedValue({ user: { email: "user@example.com" } })

    const response = await GET(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "forbidden",
      message: "Google Calendar reconnection requires the configured admin account.",
    })
    expect(mocks.exchangeCalendarCode).not.toHaveBeenCalled()
  })

  it("keeps state validation before exchanging the OAuth code", async () => {
    mocks.auth.mockResolvedValue({ user: { email: "admin@example.com" } })
    mocks.cookies.get.mockReturnValue({ value: "state_1" })

    const response = await GET(request("?code=code_1&state=bad_state"))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "invalid_state" })
    expect(mocks.exchangeCalendarCode).not.toHaveBeenCalled()
    expect(mocks.prisma.calendarToken.upsert).not.toHaveBeenCalled()
  })

  it("exchanges and stores the calendar token for admin users with a valid state", async () => {
    mocks.auth.mockResolvedValue({ user: { email: "admin@example.com" } })

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.cookies.delete).toHaveBeenCalledWith("calendar_oauth_state")
    expect(mocks.exchangeCalendarCode).toHaveBeenCalledWith("code_1")
    expect(mocks.prisma.calendarToken.upsert).toHaveBeenCalledWith({
      where: { userId: "satoshi-calendar-owner" },
      update: {
        accessToken: "access_token",
        refreshToken: "refresh_token",
        expiresAt: new Date("2026-06-28T00:00:00.000Z"),
        scope: "https://www.googleapis.com/auth/calendar",
      },
      create: {
        userId: "satoshi-calendar-owner",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        expiresAt: new Date("2026-06-28T00:00:00.000Z"),
        scope: "https://www.googleapis.com/auth/calendar",
      },
    })
  })
})
