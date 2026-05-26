import { beforeEach, describe, expect, it, vi } from "vitest"

const resendMocks = vi.hoisted(() => {
  const send = vi.fn()
  const Resend = vi.fn(function Resend() {
    return { emails: { send } }
  })
  return { Resend, send }
})

vi.mock("resend", () => ({
  Resend: resendMocks.Resend,
}))

describe("auth email sender", () => {
  beforeEach(() => {
    vi.resetModules()
    resendMocks.Resend.mockClear()
    resendMocks.send.mockReset()
    resendMocks.send.mockResolvedValue({ data: { id: "email-id" }, error: null })
    process.env.RESEND_API_KEY = "secret-api-key"
    process.env.RESEND_FROM_EMAIL = "studio@example.com"
    process.env.AUTH_URL = "https://norikane.studio"
    process.env.AUTH_SECRET = "secret-auth-value"
  })

  it("sends magic link email with subject, recipient, and url without leaking secrets", async () => {
    const { sendMagicLinkEmail } = await import("../email")

    await sendMagicLinkEmail({
      to: "client@example.com",
      url: "https://norikane.studio/api/auth/callback/resend?callbackUrl=%2Fbooking",
    })

    expect(resendMocks.send).toHaveBeenCalledWith(expect.objectContaining({
      from: "studio@example.com",
      to: "client@example.com",
      subject: "ログインリンク / norikane.studio",
    }))
    const payload = resendMocks.send.mock.calls[0]?.[0]
    expect(payload.text).toContain("https://norikane.studio/api/auth/callback/resend?callbackUrl=%2Fbooking")
    expect(payload.text).not.toContain("secret-api-key")
    expect(payload.text).not.toContain("secret-auth-value")
  })
})
