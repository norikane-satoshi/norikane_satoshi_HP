import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  limitByIp: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    passwordResetToken: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  },
  randomDelay: vi.fn(),
  rateLimited: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  timingSafeCompare: vi.fn(),
}))

vi.mock("@/lib/auth/server/email", () => ({ sendPasswordResetEmail: mocks.sendPasswordResetEmail }))
vi.mock("@/lib/auth/server/timing-safe", () => ({
  randomDelay: mocks.randomDelay,
  timingSafeCompare: mocks.timingSafeCompare,
}))
vi.mock("@/lib/auth/server/tokens", () => ({
  PASSWORD_RESET_TTL_MS: 3_600_000,
  newToken: () => "reset_token",
}))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))
vi.mock("@/lib/rate-limit/server", () => ({
  limitByIp: mocks.limitByIp,
  rateLimitEmailIdentifier: (email: string) => `email:${email}`,
  rateLimited: mocks.rateLimited,
}))

function request(body: unknown) {
  const raw = JSON.stringify(body)
  return new NextRequest("http://localhost/api/auth/forgot-password", {
    method: "POST",
    body: raw,
    headers: { "Content-Length": String(Buffer.byteLength(raw)) },
  })
}

async function loadPost() {
  vi.resetModules()
  const route = await import("@/app/api/auth/forgot-password/route")
  return route.POST
}

describe("POST /api/auth/forgot-password timing hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.limitByIp.mockResolvedValue({ limited: false, headers: new Headers() })
    mocks.rateLimited.mockResolvedValue({ limited: false, headers: new Headers() })
    mocks.randomDelay.mockResolvedValue(undefined)
    mocks.timingSafeCompare.mockResolvedValue(false)
  })

  it("runs dummy compare and delay when the user is absent", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null)
    const POST = await loadPost()

    const response = await POST(request({ email: "missing@example.com" }))

    expect(response.status).toBe(200)
    expect(mocks.timingSafeCompare).toHaveBeenCalledWith("dummy", null)
    expect(mocks.randomDelay).toHaveBeenCalledTimes(1)
  })

  it("runs dummy compare and delay when the user is not verified", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      email: "satoshi@example.com",
      emailVerified: null,
    })
    const POST = await loadPost()

    const response = await POST(request({ email: "satoshi@example.com" }))

    expect(response.status).toBe(200)
    expect(mocks.timingSafeCompare).toHaveBeenCalledWith("dummy", null)
    expect(mocks.randomDelay).toHaveBeenCalledTimes(1)
  })
})
