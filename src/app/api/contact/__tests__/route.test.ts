import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  limitByIp: vi.fn(),
  resendSend: vi.fn(),
  resendConstructor: vi.fn(),
}))

vi.mock("@/lib/rate-limit/server", () => ({
  limitByIp: mocks.limitByIp,
}))

vi.mock("resend", () => ({
  Resend: vi.fn(function ResendMock(apiKey: string) {
    mocks.resendConstructor(apiKey)
    return { emails: { send: mocks.resendSend } }
  }),
}))

import { POST } from "@/app/api/contact/route"

function contactRequest(body: unknown) {
  const raw = JSON.stringify(body)
  return new NextRequest("http://localhost/api/contact", {
    method: "POST",
    body: raw,
    headers: {
      "Content-Length": String(Buffer.byteLength(raw)),
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
    },
  })
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Satoshi",
    email: "client@example.com",
    body: "お問い合わせ本文です。十分な長さがあります。",
    ...overrides,
  }
}

describe("POST /api/contact Resend delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("BOOKING_CALENDAR_ADMIN_EMAIL", "norikane.satoshi@gmail.com")
    vi.stubEnv("RESEND_FROM_EMAIL", "noreply@norikane.studio")
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.limitByIp.mockResolvedValue({ limited: false, headers: new Headers() })
    mocks.resendSend.mockResolvedValue({ data: { id: "email_1" }, error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("sends the inquiry email through Resend when the API key is configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-resend-key")

    const response = await POST(contactRequest(validBody()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.resendConstructor).toHaveBeenCalledWith("test-resend-key")
    expect(mocks.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "noreply@norikane.studio",
        to: "norikane.satoshi@gmail.com",
        replyTo: "client@example.com",
        subject: expect.stringMatching(/^\[HP お問い合わせ\]/),
      }),
    )
  })

  it("skips Resend and warns when the API key is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "")

    const response = await POST(contactRequest(validBody()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.resendSend).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith("[Contact] RESEND_API_KEY not set, skipping send")
  })

  it("keeps the customer response successful when Resend fails", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-resend-key")
    const err = new Error("resend unavailable")
    mocks.resendSend.mockRejectedValue(err)

    const response = await POST(contactRequest(validBody()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(console.error).toHaveBeenCalledWith("[Contact] resend send failed", err)
  })
})
