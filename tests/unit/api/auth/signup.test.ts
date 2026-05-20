import { NextRequest, NextResponse } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  hash: vi.fn(),
  hashSync: vi.fn(),
  limitByIp: vi.fn(),
  newToken: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    verificationToken: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  },
  rateLimited: vi.fn(),
  sendVerificationEmail: vi.fn(),
}))

vi.mock("bcryptjs", () => ({ default: { compare: mocks.compare, hash: mocks.hash, hashSync: mocks.hashSync } }))
vi.mock("@/lib/auth/server/email", () => ({
  sendVerificationEmail: mocks.sendVerificationEmail,
}))
vi.mock("@/lib/auth/server/tokens", () => ({
  VERIFICATION_TOKEN_TTL_MS: 86_400_000,
  newToken: mocks.newToken,
}))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))
vi.mock("@/lib/rate-limit/server", () => ({
  limitByIp: mocks.limitByIp,
  rateLimitEmailIdentifier: (email: string) => `email:${email}`,
  rateLimited: mocks.rateLimited,
}))

function request(body: unknown) {
  return new NextRequest("http://localhost/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

async function loadPost() {
  vi.resetModules()
  const route = await import("@/app/api/auth/signup/route")
  return route.POST
}

describe("POST /api/auth/signup rate limits", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-20T00:00:00.000Z"))
    vi.clearAllMocks()
    mocks.compare.mockResolvedValue(true)
    mocks.hash.mockResolvedValue("hashed_password")
    mocks.hashSync.mockReturnValue("dummy_hash")
    mocks.limitByIp.mockResolvedValue({ limited: false, headers: new Headers() })
    mocks.rateLimited.mockResolvedValue({ limited: false, headers: new Headers() })
    mocks.newToken.mockReturnValue("verification_token")
    mocks.prisma.user.findUnique.mockResolvedValue(null)
    mocks.prisma.user.create.mockResolvedValue({ id: "user_1", emailVerified: null })
    mocks.prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 })
    mocks.prisma.verificationToken.create.mockResolvedValue({})
    mocks.sendVerificationEmail.mockResolvedValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("checks IP and email limits before creating the user", async () => {
    const POST = await loadPost()

    const response = await POST(
      request({ email: "Satoshi@Example.com", password: "password123", name: "Satoshi" }),
    )

    expect(response.status).toBe(200)
    expect(mocks.limitByIp).toHaveBeenCalledWith("signupIp", expect.any(NextRequest))
    expect(mocks.rateLimited).toHaveBeenCalledWith("signupEmail", "email:satoshi@example.com")
    expect(mocks.prisma.user.create).toHaveBeenCalled()
  })

  it("returns 429 when the signup IP limit is exceeded", async () => {
    mocks.limitByIp.mockResolvedValue({
      limited: true,
      headers: new Headers(),
      response: NextResponse.json({ error: "too many requests" }, { status: 429 }),
    })
    const POST = await loadPost()

    const response = await POST(request({ email: "satoshi@example.com", password: "password123" }))

    expect(response.status).toBe(429)
    expect(mocks.hash).not.toHaveBeenCalled()
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it("returns 429 when the signup email limit is exceeded", async () => {
    mocks.rateLimited.mockResolvedValue({
      limited: true,
      headers: new Headers(),
      response: NextResponse.json({ error: "too many requests" }, { status: 429 }),
    })
    const POST = await loadPost()

    const response = await POST(request({ email: "satoshi@example.com", password: "password123" }))

    expect(response.status).toBe(429)
    expect(mocks.hash).not.toHaveBeenCalled()
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled()
  })
})
