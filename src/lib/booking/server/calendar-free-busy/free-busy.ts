import {
  CalendarOAuthEnvMissingError,
  CalendarTokenRevokedError,
  listBusyEventsWithBuffer,
  type CalendarBusyEventWithBuffer,
} from "@/lib/google-calendar/server"
import { listBookings, type CalendarBookingFromApi } from "./bookings-repository"
import {
  clearCalendarAccessTokenCacheForTest,
  getCachedCalendarAccessToken,
} from "./google-token-cache"

export type { CalendarBookingFromApi } from "./bookings-repository"

const FREE_BUSY_TTL_MS = 15 * 1000
const RANGE_BUCKET_MS = 15 * 60 * 1000

export type CalendarFreeBusyValue = {
  busy: CalendarBusyEventWithBuffer[]
  bookings: CalendarBookingFromApi[]
}

export type CalendarFreeBusyTimings = {
  db: number
  oauthRefresh: number
  gcal: number
}

export type CalendarFreeBusyResult = CalendarFreeBusyValue & {
  code?: string
  status: number
  timings: CalendarFreeBusyTimings
  cache: "hit" | "miss" | "bypass"
}

type FreeBusyCacheEntry = {
  value: CalendarFreeBusyValue
  expiresAt: number
}

const freeBusyCache = new Map<string, FreeBusyCacheEntry>()
const SURFACED_CALENDAR_CODES = new Set([
  "calendar_token_revoked",
  "calendar_token_not_connected",
  "calendar_oauth_env_missing",
])

function nowMs(): number {
  return Date.now()
}

function elapsedSince(start: number): number {
  return Math.round(performance.now() - start)
}

function floorBucket(value: string): string {
  const time = new Date(value).getTime()
  return String(Math.floor(time / RANGE_BUCKET_MS) * RANGE_BUCKET_MS)
}

function cacheKey(userId: string, teamId: string | null, timeMin: string, timeMax: string): string {
  return `${userId}:${teamId ?? "self"}:${floorBucket(timeMin)}:${floorBucket(timeMax)}`
}

function withCalendarIssueLog<T extends CalendarFreeBusyResult>(result: T, userId: string): T {
  if (result.code && SURFACED_CALENDAR_CODES.has(result.code)) {
    console.warn(`[calendar-free-busy] code=${result.code} userId=${userId} at=${new Date().toISOString()}`)
  }
  return result
}

export async function getCalendarFreeBusyForUser(input: {
  userId: string
  teamId: string | null
  timeMin: string
  timeMax: string
  calendarId: string | undefined
  useCache?: boolean
}): Promise<CalendarFreeBusyResult> {
  const { userId, teamId, timeMin, timeMax, calendarId, useCache = true } = input
  const key = cacheKey(userId, teamId, timeMin, timeMax)
  const now = nowMs()
  const cached = useCache ? freeBusyCache.get(key) : undefined
  if (cached && cached.expiresAt > now) {
    return {
      ...cached.value,
      status: 200,
      timings: { db: 0, oauthRefresh: 0, gcal: 0 },
      cache: "hit",
    }
  }

  const timings: CalendarFreeBusyTimings = { db: 0, oauthRefresh: 0, gcal: 0 }
  const dbStarted = performance.now()
  const { listTeamMemberUserIds } = await import("@/lib/booking/server/team-access")
  const bookingUserIds = teamId ? await listTeamMemberUserIds(userId, teamId) : [userId]
  if (!bookingUserIds) {
    return {
      busy: [],
      bookings: [],
      code: "team_not_found",
      status: 404,
      timings,
      cache: useCache ? "miss" : "bypass",
    }
  }
  const bookings = await listBookings(timeMin, timeMax, bookingUserIds)
  timings.db = elapsedSince(dbStarted)

  if (!calendarId) {
    return {
      code: "calendar_busy_source_missing",
      busy: [],
      bookings,
      status: 503,
      timings,
      cache: useCache ? "miss" : "bypass",
    }
  }

  let accessToken: string
  try {
    const tokenResult = await getCachedCalendarAccessToken(userId)
    accessToken = tokenResult.token
    timings.oauthRefresh = tokenResult.refreshMs
  } catch (error) {
    if (error instanceof Error && error.message === "calendar_token_not_connected") {
      return withCalendarIssueLog({
        code: "calendar_token_not_connected",
        busy: [],
        bookings,
        status: 200,
        timings,
        cache: useCache ? "miss" : "bypass",
      }, userId)
    }
    if (error instanceof CalendarTokenRevokedError || error instanceof CalendarOAuthEnvMissingError) {
      return withCalendarIssueLog({
        code: error.code,
        busy: [],
        bookings,
        status: error instanceof CalendarTokenRevokedError ? 401 : 503,
        timings,
        cache: useCache ? "miss" : "bypass",
      }, userId)
    }
    throw error
  }

  let busy: CalendarBusyEventWithBuffer[]
  try {
    const gcalStarted = performance.now()
    busy = await listBusyEventsWithBuffer(calendarId, timeMin, timeMax, accessToken)
    timings.gcal = elapsedSince(gcalStarted)
  } catch (error) {
    if (error instanceof CalendarTokenRevokedError || error instanceof CalendarOAuthEnvMissingError) {
      return withCalendarIssueLog({
        code: error.code,
        busy: [],
        bookings,
        status: error instanceof CalendarTokenRevokedError ? 401 : 503,
        timings,
        cache: useCache ? "miss" : "bypass",
      }, userId)
    }
    throw error
  }

  const bookingTimePairs = new Set(
    bookings.map((booking) => `${new Date(booking.start).getTime()}|${new Date(booking.end).getTime()}`),
  )
  const value = {
    busy: busy.filter(
      (slot) => !bookingTimePairs.has(`${new Date(slot.start).getTime()}|${new Date(slot.end).getTime()}`),
    ),
    bookings,
  }

  if (useCache) {
    freeBusyCache.set(key, { value, expiresAt: nowMs() + FREE_BUSY_TTL_MS })
  }

  return {
    ...value,
    status: 200,
    timings,
    cache: useCache ? "miss" : "bypass",
  }
}

export function calendarErrorStatus(error: unknown): { code: string; status: number } {
  if (error instanceof CalendarTokenRevokedError) {
    return { code: error.code, status: 401 }
  }
  if (error instanceof CalendarOAuthEnvMissingError) {
    return { code: error.code, status: 503 }
  }
  return { code: "calendar_free_busy_failed", status: 503 }
}

export function invalidateCalendarFreeBusyCacheForUser(userId: string, teamId?: string | null): void {
  const prefix = `${userId}:${teamId ?? "self"}:`
  for (const key of freeBusyCache.keys()) {
    const matchesUser = teamId === undefined ? key.startsWith(`${userId}:`) : key.startsWith(prefix)
    const matchesTeam = typeof teamId === "string" && key.includes(`:${teamId}:`)
    if (matchesUser || matchesTeam) {
      freeBusyCache.delete(key)
    }
  }
}

export function clearCalendarFreeBusyCachesForTest(): void {
  if (process.env.NODE_ENV !== "test") return
  freeBusyCache.clear()
  clearCalendarAccessTokenCacheForTest()
}
