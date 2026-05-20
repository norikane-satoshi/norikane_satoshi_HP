import { createHash } from "node:crypto"
import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"
import { getClientIp } from "@/lib/security/server/client-ip"

type Duration = Parameters<typeof Ratelimit.fixedWindow>[1]

type RateLimitName =
  | "signupIp"
  | "signupEmail"
  | "forgotPasswordIp"
  | "forgotPasswordEmail"
  | "verifyEmailIp"
  | "contactIp"

type RateLimitConfig = {
  prefix: string
  tokens: number
  window: Duration
}

type RateLimitAllowed = {
  limited: false
  headers: Headers
}

type RateLimitBlocked = {
  limited: true
  headers: Headers
  response: NextResponse
}

type RateLimitDecision = RateLimitAllowed | RateLimitBlocked

const RATE_LIMITS: Record<RateLimitName, RateLimitConfig> = {
  signupIp: { prefix: "auth:signup:ip", tokens: 5, window: "10 m" },
  signupEmail: { prefix: "auth:signup:email", tokens: 3, window: "1 h" },
  forgotPasswordIp: { prefix: "auth:forgot-password:ip", tokens: 5, window: "10 m" },
  forgotPasswordEmail: { prefix: "auth:forgot-password:email", tokens: 3, window: "1 h" },
  verifyEmailIp: { prefix: "auth:verify-email:ip", tokens: 30, window: "10 m" },
  contactIp: { prefix: "contact:ip", tokens: 1, window: "5 m" },
}

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null

export const rateLimiters: Record<RateLimitName, Ratelimit | null> = Object.fromEntries(
  Object.entries(RATE_LIMITS).map(([name, config]) => [
    name,
    redis
      ? new Ratelimit({
          redis,
          limiter: Ratelimit.fixedWindow(config.tokens, config.window),
          prefix: config.prefix,
        })
      : null,
  ]),
) as Record<RateLimitName, Ratelimit | null>

export function rateLimitIdentifier(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex")
}

export function rateLimitEmailIdentifier(email: string): string {
  return rateLimitIdentifier(email)
}

export function rateLimitIpIdentifier(request: Request): string {
  return getClientIp(request)
}

export async function rateLimited(
  limiterName: RateLimitName,
  identifier: string,
  message = "too many requests",
): Promise<RateLimitDecision> {
  const headers = new Headers()
  const limiter = rateLimiters[limiterName]
  if (!limiter) {
    return { limited: false, headers }
  }

  try {
    const result = await limiter.limit(identifier)
    headers.set("X-RateLimit-Limit", String(result.limit))
    headers.set("X-RateLimit-Remaining", String(result.remaining))
    headers.set("X-RateLimit-Reset", String(result.reset))

    if (result.success) {
      return { limited: false, headers }
    }

    const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
    headers.set("Retry-After", String(retryAfter))
    return {
      limited: true,
      headers,
      response: NextResponse.json({ error: message }, { status: 429, headers }),
    }
  } catch (error) {
    console.error("[rate-limit] Upstash request failed", error)
    return { limited: false, headers }
  }
}

export async function limitByIp(
  limiterName: Extract<RateLimitName, "signupIp" | "forgotPasswordIp" | "verifyEmailIp" | "contactIp">,
  request: Request,
  message?: string,
): Promise<RateLimitDecision> {
  return rateLimited(limiterName, rateLimitIpIdentifier(request), message)
}
