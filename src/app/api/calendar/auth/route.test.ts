import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cookies: {
    set: vi.fn(),
  },
  getCalendarAuthUrl: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mocks.cookies),
}))
vi.mock("@/lib/google-calendar/server", () => ({
  getCalendarAuthUrl: mocks.getCalendarAuthUrl,
}))

import { GET } from "./route"

function request() {
  return new NextRequest("https://norikane.studio/api/calendar/auth")
}

describe("GET /api/calendar/auth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv("BOOKING_CALENDAR_ADMIN_EMAIL", "admin@example.com")
    mocks.getCalendarAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?state=state_1")
  })

  it("redirects unauthenticated users to login with the calendar auth callback", async () => {
    mocks.auth.mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(
      "https://norikane.studio/login?callbackUrl=%2Fapi%2Fcalendar%2Fauth",
    )
    expect(mocks.cookies.set).not.toHaveBeenCalled()
  })

  it("redirects admin users to Google OAuth and stores a state cookie", async () => {
    mocks.auth.mockResolvedValue({ user: { email: "admin@example.com" } })

    const response = await GET(request())

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/v2/auth?state=state_1")
    expect(mocks.cookies.set).toHaveBeenCalledWith("calendar_oauth_state", expect.any(String), {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    })
    expect(mocks.getCalendarAuthUrl).toHaveBeenCalledWith(expect.any(String))
  })

  it("keeps logged-in non-admin users forbidden", async () => {
    mocks.auth.mockResolvedValue({ user: { email: "user@example.com" } })

    const response = await GET(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "forbidden",
      message: "Google Calendar reconnection requires the configured admin account.",
    })
    expect(mocks.cookies.set).not.toHaveBeenCalled()
  })
})
