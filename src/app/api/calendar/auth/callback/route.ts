import { timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { auth } from "@/auth"
import { CALENDAR_TOKEN_USER_ID, exchangeCalendarCode } from "@/lib/google-calendar/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const STATE_COOKIE_NAME = "calendar_oauth_state"

export async function GET(request: NextRequest) {
  const adminEmail = process.env.BOOKING_CALENDAR_ADMIN_EMAIL
  if (!adminEmail) {
    return NextResponse.json(
      { error: "calendar_admin_email_missing" },
      { status: 503 },
    )
  }

  const session = await auth()
  if (session?.user?.email !== adminEmail) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 })
  }

  const cookieStore = await cookies()
  const cookieState = cookieStore.get(STATE_COOKIE_NAME)?.value

  if (!state || !cookieState || state.length !== cookieState.length) {
    return NextResponse.json({ error: "invalid_state" }, { status: 400 })
  }
  const stateBuf = Buffer.from(state)
  const cookieBuf = Buffer.from(cookieState)
  if (stateBuf.length !== cookieBuf.length || !timingSafeEqual(stateBuf, cookieBuf)) {
    return NextResponse.json({ error: "invalid_state" }, { status: 400 })
  }

  cookieStore.delete(STATE_COOKIE_NAME)

  try {
    const token = await exchangeCalendarCode(code)
    const { prisma } = await import("@/lib/prisma")

    await prisma.calendarToken.upsert({
      where: { userId: CALENDAR_TOKEN_USER_ID },
      update: {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        scope: token.scope,
      },
      create: {
        userId: CALENDAR_TOKEN_USER_ID,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        scope: token.scope,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to store Google Calendar token" },
      { status: 500 },
    )
  }
}
