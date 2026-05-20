import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  hash: vi.fn(),
  hashSync: vi.fn(),
  limitByIp: vi.fn(),
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
vi.mock("@/lib/auth/server/email", () => ({ sendVerificationEmail: mocks.sendVerificationEmail }))
vi.mock("@/lib/auth/server/tokens", () => ({
  VERIFICATION_TOKEN_TTL_MS: 86_400_000,
  newToken: () => "verification_token",
}))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))
vi.mock("@/lib/rate-limit/server", () => ({
  limitByIp: mocks.limitByIp,
  rateLimitEmailIdentifier: (email: string) => `email:${email}`,
  rateLimited: mocks.rateLimited,
}))

function request(body: unknown) {
  const raw = JSON.stringify(body)
  return new NextRequest("http://localhost/api/auth/signup", {
    method: "POST",
    body: raw,
    headers: { "Content-Length": String(Buffer.byteLength(raw)) },
  })
}

async function loadPost() {
  vi.resetModules()
  const route = await import("@/app/api/auth/signup/route")
  return route.POST
}

describe("POST /api/auth/signup timing hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.compare.mockResolvedValue(true)
    mocks.hash.mockResolvedValue("new_hash")
    mocks.hashSync.mockReturnValue("dummy_hash")
    mocks.limitByIp.mockResolvedValue({ limited: false, headers: new Headers() })
    mocks.rateLimited.mockResolvedValue({ limited: false, headers: new Headers() })
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "satoshi@example.com",
      emailVerified: new Date("2026-05-20T00:00:00.000Z"),
      passwordHash: "existing_hash",
    })
  })

  it("runs bcrypt compare before the existing verified user response", async () => {
    const POST = await loadPost()

    const response = await POST(request({ email: "satoshi@example.com", password: "password123" }))

    expect(response.status).toBe(200)
    expect(mocks.compare).toHaveBeenCalledWith("password123", "existing_hash")
    expect(mocks.prisma.verificationToken.create).not.toHaveBeenCalled()
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled()
  })
})
