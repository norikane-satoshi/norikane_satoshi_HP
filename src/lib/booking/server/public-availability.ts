import { getCalendarFreeBusyForUser } from "@/lib/booking/server/calendar-free-busy/free-busy"
import { getNotionWorkTentativeDateKeys } from "@/lib/chatbot/server/notion-work-schedule-busy"
import { getCachedCalendarAccessToken } from "@/lib/booking/server/calendar-free-busy/google-token-cache"
import { CALENDAR_TOKEN_USER_ID, listTentativeHoldEvents } from "@/lib/google-calendar/server"
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
    const [tentative, notionTentativeDateKeys] = result.status === 200 && !result.code
      ? await Promise.all([
          loadTentativeHoldEvents(seed.range.timeMin, seed.range.timeMax),
          getNotionWorkTentativeDateKeys({ from: seed.range.timeMin, to: seed.range.timeMax }),
        ])
      : [[], []]

    return {
      ...buildPublicAvailabilityMonth({
        month: seed.month,
        now: input.now,
        busy: result.busy,
        bookings: result.bookings,
        tentative,
        tentativeDateKeys: notionTentativeDateKeys,
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

async function loadTentativeHoldEvents(timeMin: string, timeMax: string) {
  const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
  if (!calendarId) return []
  const tokenResult = await getCachedCalendarAccessToken(CALENDAR_TOKEN_USER_ID)
  return listTentativeHoldEvents(calendarId, timeMin, timeMax, tokenResult.token)
}
