import {
  CALENDAR_TOKEN_USER_ID,
  CalendarOAuthEnvMissingError,
  CalendarTokenRevokedError,
  listBusyEventsWithBuffer,
  refreshCalendarAccessToken,
  type CalendarBusyEventWithBuffer,
} from "@/lib/google-calendar"

const FREE_BUSY_TTL_MS = 15 * 1000
const ACCESS_TOKEN_TTL_MS = 50 * 60 * 1000
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000
const RANGE_BUCKET_MS = 15 * 60 * 1000

export type CalendarBookingFromApi = {
  id: string
  bookingGroupId: string
  start: string
  end: string
  title: string
  status: string
}

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

type AccessTokenCacheEntry = {
  token: string
  expiresAt: number
}

const freeBusyCache = new Map<string, FreeBusyCacheEntry>()
const accessTokenCache = new Map<string, AccessTokenCacheEntry>()

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

async function listBookings(timeMin: string, timeMax: string, userIds: string[]): Promise<CalendarBookingFromApi[]> {
  const { prisma } = await import("@/lib/prisma")
  const startDate = new Date(timeMin)
  const endDate = new Date(timeMax)
  const dbBookings = await prisma.bookingTimeSlot.findMany({
    where: {
      startTime: { lt: endDate },
      endTime: { gt: startDate },
      status: "CONFIRMED",
      bookingGroup: {
        customer: {
          userId: { in: userIds },
        },
      },
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

async function getCachedCalendarAccessToken(cacheUserId: string): Promise<{ token: string; refreshMs: number }> {
  const cached = accessTokenCache.get(cacheUserId)
  const now = nowMs()
  if (cached && cached.expiresAt > now) {
    return { token: cached.token, refreshMs: 0 }
  }

  const { prisma } = await import("@/lib/prisma")
  const storedToken = await prisma.calendarToken.findUnique({
    where: { userId: CALENDAR_TOKEN_USER_ID },
  })
  if (!storedToken) throw new Error("calendar_token_not_connected")

  const started = performance.now()
  const refreshed = await refreshCalendarAccessToken(storedToken.refreshToken)
  const refreshMs = elapsedSince(started)
  await prisma.calendarToken.update({
    where: { userId: CALENDAR_TOKEN_USER_ID },
    data: {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope,
    },
  })

  const tokenExpiresAt = Math.min(
    now + ACCESS_TOKEN_TTL_MS,
    refreshed.expiresAt.getTime() - TOKEN_EXPIRY_SKEW_MS,
  )
  accessTokenCache.set(cacheUserId, {
    token: refreshed.accessToken,
    expiresAt: Math.max(now, tokenExpiresAt),
  })
  return { token: refreshed.accessToken, refreshMs }
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
  const { listTeamMemberUserIds } = await import("@/lib/booking/team-access")
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
      return {
        code: "calendar_token_not_connected",
        busy: [],
        bookings,
        status: 200,
        timings,
        cache: useCache ? "miss" : "bypass",
      }
    }
    if (error instanceof CalendarTokenRevokedError || error instanceof CalendarOAuthEnvMissingError) {
      return {
        code: error.code,
        busy: [],
        bookings,
        status: error instanceof CalendarTokenRevokedError ? 401 : 503,
        timings,
        cache: useCache ? "miss" : "bypass",
      }
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
      return {
        code: error.code,
        busy: [],
        bookings,
        status: error instanceof CalendarTokenRevokedError ? 401 : 503,
        timings,
        cache: useCache ? "miss" : "bypass",
      }
    }
    throw error
  }

  const bookingTimePairs = new Set(
    bookings.map((booking) => `${booking.start}|${booking.end}`),
  )
  const value = {
    busy: busy.filter((slot) => !bookingTimePairs.has(`${slot.start}|${slot.end}`)),
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
  accessTokenCache.clear()
}
