import { NextRequest, NextResponse } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  limitByIp: vi.fn(),
  newToken: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    passwordResetToken: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  },
  rateLimited: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}))

vi.mock("@/lib/auth/server/email", () => ({
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}))
vi.mock("@/lib/auth/server/tokens", () => ({
  PASSWORD_RESET_TTL_MS: 3_600_000,
  newToken: mocks.newToken,
}))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))
vi.mock("@/lib/rate-limit/server", () => ({
  limitByIp: mocks.limitByIp,
  rateLimitEmailIdentifier: (email: string) => `email:${email}`,
  rateLimited: mocks.rateLimited,
}))

function request(body: unknown) {
  return new NextRequest("http://localhost/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

async function loadPost() {
  vi.resetModules()
  const route = await import("@/app/api/auth/forgot-password/route")
  return route.POST
}

describe("POST /api/auth/forgot-password rate limits", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-20T00:00:00.000Z"))
    vi.clearAllMocks()
    mocks.limitByIp.mockResolvedValue({ limited: false, headers: new Headers() })
    mocks.rateLimited.mockResolvedValue({ limited: false, headers: new Headers() })
    mocks.newToken.mockReturnValue("reset_token")
    mocks.prisma.user.findUnique.mockResolvedValue({
      email: "satoshi@example.com",
      emailVerified: new Date("2026-05-19T00:00:00.000Z"),
    })
    mocks.prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 })
    mocks.prisma.passwordResetToken.create.mockResolvedValue({})
    mocks.sendPasswordResetEmail.mockResolvedValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("checks IP and email limits before creating a reset token", async () => {
    const POST = await loadPost()

    const response = await POST(request({ email: "Satoshi@Example.com" }))

    expect(response.status).toBe(200)
    expect(mocks.limitByIp).toHaveBeenCalledWith("forgotPasswordIp", expect.any(NextRequest))
    expect(mocks.rateLimited).toHaveBeenCalledWith(
      "forgotPasswordEmail",
      "email:satoshi@example.com",
    )
    expect(mocks.prisma.passwordResetToken.create).toHaveBeenCalled()
  })

  it("returns 429 when the forgot-password IP limit is exceeded", async () => {
    mocks.limitByIp.mockResolvedValue({
      limited: true,
      headers: new Headers(),
      response: NextResponse.json({ error: "too many requests" }, { status: 429 }),
    })
    const POST = await loadPost()

    const response = await POST(request({ email: "satoshi@example.com" }))

    expect(response.status).toBe(429)
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it("returns 429 when the forgot-password email limit is exceeded", async () => {
    mocks.rateLimited.mockResolvedValue({
      limited: true,
      headers: new Headers(),
      response: NextResponse.json({ error: "too many requests" }, { status: 429 }),
    })
    const POST = await loadPost()

    const response = await POST(request({ email: "satoshi@example.com" }))

    expect(response.status).toBe(429)
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled()
  })
})
