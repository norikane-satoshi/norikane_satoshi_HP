import { randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { auth } from "@/auth"
import { respondInternalError } from "@/lib/api/server/error-response"
import { getBookingCalendarAdminEmail, isAdmin } from "@/lib/auth/server/is-admin"
import { getCalendarAuthUrl } from "@/lib/google-calendar/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CALENDAR_OAUTH_STATE_COOKIE = "calendar_oauth_state"
const STATE_COOKIE_MAX_AGE_SEC = 600
const CALENDAR_AUTH_PATH = "/api/calendar/auth"

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL("/login", request.nextUrl.origin)
  loginUrl.searchParams.set("callbackUrl", CALENDAR_AUTH_PATH)
  return NextResponse.redirect(loginUrl, 302)
}

export async function GET(request: NextRequest) {
  const adminEmail = getBookingCalendarAdminEmail()
  if (!adminEmail) {
    return NextResponse.json(
      { error: "calendar_admin_email_missing" },
      { status: 503 },
    )
  }

  const session = await auth()
  if (!session?.user) {
    return redirectToLogin(request)
  }
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json(
      {
        error: "forbidden",
        message: "Google Calendar reconnection requires the configured admin account.",
      },
      { status: 403 },
    )
  }

  try {
    const state = randomBytes(32).toString("hex")
    const cookieStore = await cookies()
    cookieStore.set(CALENDAR_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: STATE_COOKIE_MAX_AGE_SEC,
    })
    return NextResponse.redirect(getCalendarAuthUrl(state), 302)
  } catch (error) {
    return respondInternalError(error, "calendar.auth")
  }
}
