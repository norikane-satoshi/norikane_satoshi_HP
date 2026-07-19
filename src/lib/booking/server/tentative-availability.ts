import { buildTentativeAvailabilityDateKeys } from "@/lib/booking/domain/public-availability"
import { getCachedCalendarAccessToken } from "@/lib/booking/server/calendar-free-busy/google-token-cache"
import { getNotionWorkTentativeDateKeys } from "@/lib/chatbot/server/notion-work-schedule-busy"
import { listTentativeHoldEvents } from "@/lib/google-calendar/server"

export async function loadTentativeAvailabilityDateKeys(input: {
  cacheUserId: string
  timeMin: string
  timeMax: string
  calendarId?: string
}): Promise<string[]> {
  const calendarId = input.calendarId ?? process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
  const [tentative, notionTentativeDateKeys] = await Promise.all([
    calendarId
      ? getCachedCalendarAccessToken(input.cacheUserId).then(({ token }) => (
          listTentativeHoldEvents(calendarId, input.timeMin, input.timeMax, token)
        ))
      : [],
    getNotionWorkTentativeDateKeys({ from: input.timeMin, to: input.timeMax }),
  ])

  return buildTentativeAvailabilityDateKeys({
    tentative,
    tentativeDateKeys: notionTentativeDateKeys,
  })
}
