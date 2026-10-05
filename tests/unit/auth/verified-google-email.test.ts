import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { NextAuthConfig } from "next-auth"

const mocks = vi.hoisted(() => ({ updateMany: vi.fn(), nextAuth: vi.fn((config: unknown) => ({ config })) }))
vi.mock("@/lib/prisma", () => ({ prisma: { user: { updateMany: mocks.updateMany } } }))
vi.mock("next-auth", () => ({ CredentialsSignin: class extends Error {}, default: mocks.nextAuth }))
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }))
import { markVerifiedGoogleEmail } from "@/lib/auth/server/verified-google-email"

type Event = Parameters<typeof markVerifiedGoogleEmail>[0]
const event = (provider = "google"): Event => ({
  user: { id: "user_1", email: "owner@example.com" },
  account: { provider, providerAccountId: "provider_1", type: "oidc" },
  profile: { email: "owner@example.com", email_verified: true },
})
let configuredAuth: NextAuthConfig
beforeAll(async () => {
  await import("@/auth")
  configuredAuth = mocks.nextAuth.mock.calls[0]?.[0] as unknown as NextAuthConfig
}, 120_000)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers().setSystemTime(new Date("2026-09-29T12:00:00Z"))
  mocks.updateMany.mockResolvedValue({ count: 1 })
})
afterEach(() => vi.useRealTimers())

describe("verified Google sign-in", () => {
  it("marks only the persisted matching user with a null verification date", async () => {
    await markVerifiedGoogleEmail(event())
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "user_1", email: "owner@example.com", emailVerified: null },
      data: { emailVerified: new Date("2026-09-29T12:00:00Z") },
    })
  })
  it.each([false, undefined, null, "true", 1])("ignores email_verified=%s", async (verified) => {
    const input = event()
    ;(input.profile as Record<string, unknown>).email_verified = verified
    await markVerifiedGoogleEmail(input)
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
  it.each(["line", "twitter", "resend", "credentials"])("never promotes %s", async (provider) => {
    await markVerifiedGoogleEmail(event(provider))
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
  it.each(["different@example.com", "", undefined])("rejects a mismatched/missing profile address: %s", async (email) => {
    const input = event()
    input.profile!.email = email
    await markVerifiedGoogleEmail(input)
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
  it("does not overwrite an already verified date or a concurrently changed email", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 })
    await markVerifiedGoogleEmail(event())
    expect(mocks.updateMany).toHaveBeenCalledTimes(1)
    expect(mocks.updateMany.mock.calls[0][0].where).toEqual({ id: "user_1", email: "owner@example.com", emailVerified: null })
  })
  it("wires the post-persistence signIn event and keeps Resend an email provider", async () => {
    const config = configuredAuth
    expect(config.events?.signIn).toBe(markVerifiedGoogleEmail)
    expect(config.providers).toEqual(expect.arrayContaining([expect.objectContaining({ id: "resend", type: "email" })]))
  })
})
