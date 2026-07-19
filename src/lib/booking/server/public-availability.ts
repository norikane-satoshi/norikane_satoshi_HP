import { getCalendarFreeBusyForUser } from "@/lib/booking/server/calendar-free-busy/free-busy"
import { loadTentativeAvailabilityDateKeys } from "@/lib/booking/server/tentative-availability"
import { CALENDAR_TOKEN_USER_ID } from "@/lib/google-calendar/server"
import { buildPublicAvailabilityMonth } from "@/lib/booking/domain/public-availability"

export async function loadPublicAvailabilityMonth(input: {
  month?: string | null
  now?: Date
}) {
  const seed = buildPublicAvailabilityMonth({ month: input.month, now: input.now })
  try {
    const result = await getCalendarFreeBusyForUser({
      userId: CALENDAR_TOKEN_USER_ID,
      teamId: null,
      timeMin: seed.range.timeMin,
      timeMax: seed.range.timeMax,
      calendarId: process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID,
      isCalendarAdmin: false,
    })
    const tentativeDateKeys = result.status === 200 && !result.code
      ? await loadTentativeAvailabilityDateKeys({
          cacheUserId: CALENDAR_TOKEN_USER_ID,
          timeMin: seed.range.timeMin,
          timeMax: seed.range.timeMax,
        })
      : []

    return {
      ...buildPublicAvailabilityMonth({
        month: seed.month,
        now: input.now,
        busy: result.busy,
        bookings: result.bookings,
        tentativeDateKeys,
      }),
      code: result.code,
      status: result.status,
    }
  } catch (error) {
    console.warn("[public-availability] failed to load free-busy", error)
    return {
      ...seed,
      code: "public_availability_load_failed",
      status: 503,
    }
  }
}
