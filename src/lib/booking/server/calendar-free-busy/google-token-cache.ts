import { CALENDAR_TOKEN_USER_ID, refreshCalendarAccessToken } from "@/lib/google-calendar/server"

const ACCESS_TOKEN_TTL_MS = 50 * 60 * 1000
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000

type AccessTokenCacheEntry = {
  token: string
  expiresAt: number
}

const accessTokenCache = new Map<string, AccessTokenCacheEntry>()

function nowMs(): number {
  return Date.now()
}

function elapsedSince(start: number): number {
  return Math.round(performance.now() - start)
}

export async function getCachedCalendarAccessToken(
  cacheUserId: string,
): Promise<{ token: string; refreshMs: number }> {
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

export function clearCalendarAccessTokenCacheForTest(): void {
  if (process.env.NODE_ENV !== "test") return
  accessTokenCache.clear()
}
