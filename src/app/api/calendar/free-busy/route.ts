import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { isAdmin } from "@/lib/auth/server/is-admin"
import {
  calendarErrorStatus,
  getCalendarFreeBusyForUser,
  type CalendarBookingFromApi,
} from "@/lib/booking/server/calendar-free-busy/free-busy"
import { loadTentativeAvailabilityDateKeys } from "@/lib/booking/server/tentative-availability"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FREE_BUSY_CACHE_CONTROL = "private, max-age=15, stale-while-revalidate=60"

function isValidDateTime(value: string): boolean {
  return !Number.isNaN(Date.parse(value))
}

function freeBusyResponse(
  body: {
    busy: unknown[]
    bookings: CalendarBookingFromApi[]
    tentativeDateKeys?: string[]
    code?: string
  },
  status = 200,
  serverTiming?: string,
) {
  const response = NextResponse.json(body, { status })
  response.headers.set("Cache-Control", FREE_BUSY_CACHE_CONTROL)
  if (serverTiming) response.headers.set("Server-Timing", serverTiming)
  return response
}

export async function GET(request: NextRequest) {
  const timeMin = request.nextUrl.searchParams.get("timeMin") ?? request.nextUrl.searchParams.get("start")
  const timeMax = request.nextUrl.searchParams.get("timeMax") ?? request.nextUrl.searchParams.get("end")
  const teamId = request.nextUrl.searchParams.get("teamId")
  const includeTentative = request.nextUrl.searchParams.get("includeTentative") === "true"
  const useCache = !request.nextUrl.searchParams.has("refresh")
  const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
  const session = await auth()
  const userId = session?.user?.id
  const isCalendarAdmin = isAdmin(session?.user?.email)

  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  if (!timeMin || !timeMax) {
    return NextResponse.json({ error: "Missing timeMin or timeMax" }, { status: 400 })
  }
  if (!isValidDateTime(timeMin) || !isValidDateTime(timeMax)) {
    return NextResponse.json({ error: "Invalid timeMin or timeMax" }, { status: 400 })
  }
  try {
    const result = await getCalendarFreeBusyForUser({
      userId,
      teamId,
      timeMin,
      timeMax,
      calendarId,
      isCalendarAdmin,
      useCache,
    })
    const serverTiming = [
      `db;dur=${result.timings.db}`,
      `oauth;dur=${result.timings.oauthRefresh}`,
      `gcal;dur=${result.timings.gcal}`,
      `cache;desc="${result.cache}"`,
    ].join(", ")
    if (result.code === "team_not_found") {
      return NextResponse.json({ error: "team_not_found" }, { status: 404 })
    }
    let tentativeDateKeys: string[] | undefined
    if (includeTentative && result.status === 200 && !result.code) {
      try {
        tentativeDateKeys = await loadTentativeAvailabilityDateKeys({
          cacheUserId: userId,
          timeMin,
          timeMax,
          calendarId,
        })
      } catch (error) {
        console.warn("[calendar-free-busy] tentative availability load failed", error)
        tentativeDateKeys = []
      }
    }
    return freeBusyResponse(
      {
        code: result.code,
        busy: result.busy,
        bookings: result.bookings,
        ...(includeTentative ? { tentativeDateKeys: tentativeDateKeys ?? [] } : {}),
      },
      result.status,
      serverTiming,
    )
  } catch (error) {
    const known = calendarErrorStatus(error)
    return freeBusyResponse({ code: known.code, busy: [], bookings: [] }, known.status)
  }
}
