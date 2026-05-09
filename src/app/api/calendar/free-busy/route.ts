import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import {
  CALENDAR_TOKEN_USER_ID,
  CalendarOAuthEnvMissingError,
  CalendarTokenRevokedError,
  getFreeBusy,
  refreshCalendarAccessToken,
} from "@/lib/google-calendar"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isValidDateTime(value: string): boolean {
  return !Number.isNaN(Date.parse(value))
}

async function listBookings(timeMin: string, timeMax: string) {
  const { prisma } = await import("@/lib/prisma")
  const startDate = new Date(timeMin)
  const endDate = new Date(timeMax)
  const dbBookings = await prisma.bookingTimeSlot.findMany({
    where: {
      startTime: { lt: endDate },
      endTime: { gt: startDate },
      status: { in: ["CONFIRMED", "TENTATIVE", "PENDING_CONFIRMATION"] },
    },
    select: {
      id: true,
      bookingGroupId: true,
      startTime: true,
      endTime: true,
      status: true,
      bookingGroup: {
        select: {
          projectTitle: true,
          status: true,
        },
      },
    },
  })

  return dbBookings.map((booking) => ({
    id: booking.id,
    bookingGroupId: booking.bookingGroupId,
    start: booking.startTime.toISOString(),
    end: booking.endTime.toISOString(),
    title: booking.bookingGroup.projectTitle,
    status: booking.bookingGroup.status,
  }))
}

function calendarErrorResponse(error: unknown, bookings: Awaited<ReturnType<typeof listBookings>>) {
  if (error instanceof CalendarTokenRevokedError) {
    return NextResponse.json({ code: error.code, busy: [], bookings }, { status: 401 })
  }
  if (error instanceof CalendarOAuthEnvMissingError) {
    return NextResponse.json({ code: error.code, busy: [], bookings }, { status: 503 })
  }
  return NextResponse.json({ code: "calendar_free_busy_failed", busy: [], bookings }, { status: 503 })
}

export async function GET(request: NextRequest) {
  const timeMin = request.nextUrl.searchParams.get("timeMin") ?? request.nextUrl.searchParams.get("start")
  const timeMax = request.nextUrl.searchParams.get("timeMax") ?? request.nextUrl.searchParams.get("end")
  const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID

  if (!timeMin || !timeMax) {
    return NextResponse.json({ error: "Missing timeMin or timeMax" }, { status: 400 })
  }
  if (!isValidDateTime(timeMin) || !isValidDateTime(timeMax)) {
    return NextResponse.json({ error: "Invalid timeMin or timeMax" }, { status: 400 })
  }
  try {
    const { prisma } = await import("@/lib/prisma")
    const bookings = await listBookings(timeMin, timeMax)
    if (!calendarId) {
      return NextResponse.json({ code: "calendar_busy_source_missing", busy: [], bookings }, { status: 503 })
    }
    const storedToken = await prisma.calendarToken.findUnique({
      where: { userId: CALENDAR_TOKEN_USER_ID },
    })

    if (!storedToken) {
      return NextResponse.json({ code: "calendar_token_not_connected", busy: [], bookings })
    }

    const refreshed = await refreshCalendarAccessToken(storedToken.refreshToken)
    await prisma.calendarToken.update({
      where: { userId: CALENDAR_TOKEN_USER_ID },
      data: {
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
        scope: refreshed.scope,
      },
    })

    const busy = await getFreeBusy(calendarId, timeMin, timeMax, refreshed.accessToken)

    const bookingTimePairs = new Set(
      bookings.map((booking) => `${booking.start}|${booking.end}`),
    )
    const busyDeduped = busy.filter(
      (slot) => !bookingTimePairs.has(`${slot.start}|${slot.end}`),
    )

    return NextResponse.json({ busy: busyDeduped, bookings })
  } catch (error) {
    const bookings = timeMin && timeMax && isValidDateTime(timeMin) && isValidDateTime(timeMax)
      ? await listBookings(timeMin, timeMax).catch(() => [])
      : []
    return calendarErrorResponse(error, bookings)
  }
}
