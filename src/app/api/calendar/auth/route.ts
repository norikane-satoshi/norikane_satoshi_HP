import { randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { auth } from "@/auth"
import { getBookingCalendarAdminEmail, isAdmin } from "@/lib/auth/server/is-admin"
import { getCalendarAuthUrl } from "@/lib/google-calendar/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const CALENDAR_OAUTH_STATE_COOKIE = "calendar_oauth_state"
const STATE_COOKIE_MAX_AGE_SEC = 600

export async function GET() {
  const adminEmail = getBookingCalendarAdminEmail()
  if (!adminEmail) {
    return NextResponse.json(
      { error: "calendar_admin_email_missing" },
      { status: 503 },
    )
  }

  const session = await auth()
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create Google Calendar auth URL" },
      { status: 500 },
    )
  }
}
