import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  encode: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock("next-auth/jwt", () => ({
  encode: mocks.encode,
}))

async function loadRoute() {
  vi.resetModules()
  vi.doMock("@/lib/prisma", () => ({
    prisma: {
      user: {
        findUnique: mocks.findUnique,
      },
    },
  }))
  return import("@/app/api/dev/auth-bypass/route")
}

function stubEnv(env: {
  NODE_ENV: string
  VERCEL_ENV?: string
  VERCEL?: string
}) {
  vi.stubEnv("NODE_ENV", env.NODE_ENV)
  vi.stubEnv("VERCEL_ENV", env.VERCEL_ENV)
  vi.stubEnv("VERCEL", env.VERCEL)
  vi.stubEnv("AUTH_SECRET", "auth_secret_test")
}

describe("GET /api/dev/auth-bypass", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("sets a session cookie in local development", async () => {
    stubEnv({ NODE_ENV: "development" })
    mocks.findUnique.mockResolvedValue({
      id: "user_1",
      email: "norikane.satoshi@gmail.com",
      name: "Test User",
      image: null,
    })
    mocks.encode.mockResolvedValue("session_token")
    const { GET } = await loadRoute()

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, userId: "user_1" })
    expect(response.headers.get("set-cookie")).toContain("authjs.session-token=session_token")
  })

  it("returns 404 on Vercel even when VERCEL_ENV is development", async () => {
    stubEnv({ NODE_ENV: "development", VERCEL_ENV: "development", VERCEL: "1" })
    const { GET } = await loadRoute()

    expect((await GET()).status).toBe(404)
  })

  it("returns 404 when NODE_ENV is production", async () => {
    stubEnv({ NODE_ENV: "production" })
    const { GET } = await loadRoute()

    expect((await GET()).status).toBe(404)
  })

  it("returns 404 when VERCEL_ENV is preview", async () => {
    stubEnv({ NODE_ENV: "development", VERCEL_ENV: "preview" })
    const { GET } = await loadRoute()

    expect((await GET()).status).toBe(404)
  })

  it("returns 404 when VERCEL_ENV is production", async () => {
    stubEnv({ NODE_ENV: "development", VERCEL_ENV: "production" })
    const { GET } = await loadRoute()

    expect((await GET()).status).toBe(404)
  })
})
