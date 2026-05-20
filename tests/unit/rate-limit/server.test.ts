import { NextResponse } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  fixedWindow: vi.fn((tokens: number, window: string) => ({ tokens, window })),
  redis: vi.fn(),
  ratelimit: vi.fn(function Ratelimit(this: { limit: unknown }) {
    this.limit = mocks.limit
  }),
}))

vi.mock("@upstash/redis", () => ({ Redis: mocks.redis }))
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: Object.assign(mocks.ratelimit, { fixedWindow: mocks.fixedWindow }),
}))

async function loadModule(env = false) {
  vi.resetModules()
  if (env) {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example")
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token")
  } else {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "")
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "")
  }
  return import("@/lib/rate-limit/server")
}

describe("rate-limit server helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it("hashes identifiers case-insensitively", async () => {
    const { rateLimitIdentifier } = await loadModule()

    expect(rateLimitIdentifier(" Satoshi@Example.com ")).toBe(
      rateLimitIdentifier("satoshi@example.com"),
    )
  })

  it("allows requests when Upstash env is absent", async () => {
    const { rateLimited } = await loadModule()

    await expect(rateLimited("signupIp", "203.0.113.2")).resolves.toMatchObject({
      limited: false,
    })
    expect(mocks.ratelimit).not.toHaveBeenCalled()
  })

  it("returns 429 with retry headers when Upstash denies a key", async () => {
    vi.setSystemTime(new Date("2026-05-20T00:00:00.000Z"))
    mocks.limit.mockResolvedValue({
      success: false,
      limit: 3,
      remaining: 0,
      reset: Date.now() + 30_000,
      pending: Promise.resolve(),
    })
    const { rateLimited } = await loadModule(true)

    const result = await rateLimited("signupEmail", "email_hash")

    expect(result.limited).toBe(true)
    if (result.limited) {
      expect(result.response).toBeInstanceOf(NextResponse)
      expect(result.response.status).toBe(429)
      expect(result.headers.get("Retry-After")).toBe("30")
    }
    vi.useRealTimers()
  })

  it("limits IP requests using the extracted client address", async () => {
    mocks.limit.mockResolvedValue({
      success: true,
      limit: 5,
      remaining: 4,
      reset: Date.now() + 60_000,
      pending: Promise.resolve(),
    })
    const { limitByIp } = await loadModule(true)
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    })

    await expect(limitByIp("forgotPasswordIp", request)).resolves.toMatchObject({
      limited: false,
    })
    expect(mocks.limit).toHaveBeenCalledWith("203.0.113.9")
  })
})
