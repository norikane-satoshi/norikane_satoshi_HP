import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resendSend: vi.fn(),
  resendConstructor: vi.fn(),
  appendMessage: vi.fn(),
}))

vi.mock("resend", () => ({
  Resend: vi.fn(function ResendMock(apiKey: string) {
    mocks.resendConstructor(apiKey)
    return { emails: { send: mocks.resendSend } }
  }),
}))

vi.mock("@/lib/chatbot/server/repository", () => ({
  appendMessage: mocks.appendMessage,
}))

import { POST } from "./route"

function request(body: unknown) {
  return new NextRequest("http://localhost/api/chatbot/submit-inquiry", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "田中",
    email: "client@example.com",
    jobType: "CM",
    duration: "30秒",
    desiredDeadline: "2026-06-30",
    freeText: "LLM 障害時の問い合わせです",
    conversationId: "conv_1",
    ...overrides,
  }
}

describe("POST /api/chatbot/submit-inquiry", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("BOOKING_CALENDAR_ADMIN_EMAIL", "admin@example.com")
    vi.stubEnv("RESEND_FROM_EMAIL", "noreply@norikane.studio")
    vi.stubEnv("RESEND_API_KEY", "test-resend-key")
    mocks.resendSend.mockResolvedValue({ data: { id: "email_1" }, error: null })
    mocks.appendMessage.mockResolvedValue(undefined)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("sends valid inquiry email with the required subject prefix", async () => {
    const response = await POST(request(validBody()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.resendConstructor).toHaveBeenCalledWith("test-resend-key")
    expect(mocks.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "noreply@norikane.studio",
        to: "admin@example.com",
        replyTo: "client@example.com",
        subject: expect.stringMatching(/^\[LLM 障害時フォーム\]/),
      }),
    )
    expect(mocks.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_1",
        role: "system",
      }),
    )
  })

  it("returns emailSkipped when RESEND_API_KEY is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "")

    const response = await POST(request(validBody({ conversationId: undefined })))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, emailSkipped: true })
    expect(mocks.resendSend).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith("[Chatbot Inquiry] RESEND_API_KEY not set, skipping send")
  })

  it("returns 400 for invalid email", async () => {
    const response = await POST(request(validBody({ email: "invalid" })))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" })
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it("keeps the UX successful when Resend fails without exposing tokens", async () => {
    mocks.resendSend.mockRejectedValue(new Error("provider unavailable"))

    const response = await POST(request(validBody()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, emailWarning: "send_failed" })
    expect(console.error).toHaveBeenCalledWith("[Chatbot Inquiry] resend send failed", "provider unavailable")
  })
})
