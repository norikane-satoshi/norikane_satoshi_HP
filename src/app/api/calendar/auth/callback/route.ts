import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { CALENDAR_TOKEN_USER_ID, exchangeCalendarCode } from "@/lib/google-calendar"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 })
  }

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
