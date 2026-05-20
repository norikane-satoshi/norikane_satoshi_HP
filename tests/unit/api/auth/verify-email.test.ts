import { NextRequest, NextResponse } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  limitByIp: vi.fn(),
  prisma: {
    verificationToken: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))
vi.mock("@/lib/rate-limit/server", () => ({ limitByIp: mocks.limitByIp }))

function request() {
  return new NextRequest("http://localhost/api/auth/verify-email/token_1", {
    method: "GET",
  })
}

function ctx(token = "token_1") {
  return { params: Promise.resolve({ token }) }
}

async function loadGet() {
  vi.resetModules()
  const route = await import("@/app/api/auth/verify-email/[token]/route")
  return route.GET
}

describe("GET /api/auth/verify-email/[token] rate limits", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-20T00:00:00.000Z"))
    vi.clearAllMocks()
    mocks.limitByIp.mockResolvedValue({ limited: false, headers: new Headers() })
    mocks.prisma.verificationToken.findUnique.mockResolvedValue({
      identifier: "satoshi@example.com",
      token: "token_1",
      expires: new Date("2026-05-20T00:10:00.000Z"),
    })
    mocks.prisma.user.update.mockResolvedValue({})
    mocks.prisma.verificationToken.delete.mockResolvedValue({})
    mocks.prisma.$transaction.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("checks the verify-email IP limit before reading the token", async () => {
    const GET = await loadGet()

    const response = await GET(request(), ctx())

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toContain("/login?verified=1")
    expect(mocks.limitByIp).toHaveBeenCalledWith("verifyEmailIp", expect.any(NextRequest))
    expect(mocks.prisma.verificationToken.findUnique).toHaveBeenCalledWith({
      where: { token: "token_1" },
    })
  })

  it("redirects without reading the token when the verify-email IP limit is exceeded", async () => {
    mocks.limitByIp.mockResolvedValue({
      limited: true,
      headers: new Headers({ "Retry-After": "60" }),
      response: NextResponse.json({ error: "too many requests" }, { status: 429 }),
    })
    const GET = await loadGet()

    const response = await GET(request(), ctx())

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toContain("/login?verifyError=rate_limited")
    expect(response.headers.get("Retry-After")).toBe("60")
    expect(mocks.prisma.verificationToken.findUnique).not.toHaveBeenCalled()
  })
})
