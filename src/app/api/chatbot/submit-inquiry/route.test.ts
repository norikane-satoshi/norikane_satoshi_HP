import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  sendOperatorConsultationNotification: vi.fn(),
  hasSentOperatorNotification: vi.fn(),
  appendMessage: vi.fn(),
  loadConversationById: vi.fn(),
}))

vi.mock("@/lib/chatbot/server/operator-notification", () => ({
  hasSentOperatorNotification: mocks.hasSentOperatorNotification,
  sendOperatorConsultationNotification: mocks.sendOperatorConsultationNotification,
}))

vi.mock("@/lib/chatbot/server/repository", () => ({
  appendMessage: mocks.appendMessage,
  loadConversationById: mocks.loadConversationById,
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
    freeText: "AI応答補助の問い合わせです",
    conversationId: "conv_1",
    ...overrides,
  }
}

describe("POST /api/chatbot/submit-inquiry", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendOperatorConsultationNotification.mockResolvedValue({ status: "sent", id: "email_1" })
    mocks.hasSentOperatorNotification.mockReturnValue(false)
    mocks.appendMessage.mockResolvedValue(undefined)
    mocks.loadConversationById.mockResolvedValue({
      id: "conv_1",
      startedAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z",
      status: "open",
      context: {
        sessionId: "session_1",
        jobContext: {
          finalMedium: "web",
          jobKind: "cm-30s",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
          projectLengthMinutes: 4,
        },
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasProjectLength: true,
          hasAdditionalWork: true,
          hasDocumentaryAttachments: true,
          hasWorkSite: true,
          hasDesiredSchedule: true,
          hasContactEmail: true,
          turnCount: 4,
        },
      },
      messages: [],
    })
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("sends a valid inquiry email with the consultation summary context", async () => {
    const response = await POST(request(validBody()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.loadConversationById).toHaveBeenCalledWith("conv_1")
    expect(mocks.sendOperatorConsultationNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "inquiry-form",
        jobContext: expect.objectContaining({ finalMedium: "web", jobKind: "cm-30s" }),
        conversationState: expect.objectContaining({
          contactEmail: "client@example.com",
          customerName: "田中",
        }),
        fallback: expect.objectContaining({
          customerName: "田中",
          contactEmail: "client@example.com",
          jobKind: "CM",
          projectLength: "30秒",
          publicReleaseDate: "2026-06-30",
        }),
        freeText: expect.stringContaining("AI応答補助の問い合わせです"),
      }),
    )
    expect(mocks.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_1",
        role: "system",
      }),
    )
  })

  it("returns emailSkipped when the sender safely skips without RESEND_API_KEY", async () => {
    mocks.sendOperatorConsultationNotification.mockResolvedValueOnce({
      status: "skipped",
      reason: "missing-resend-api-key",
    })

    const response = await POST(request(validBody({ conversationId: undefined })))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, emailSkipped: true })
    expect(mocks.loadConversationById).not.toHaveBeenCalled()
  })

  it("returns 400 for invalid email", async () => {
    const response = await POST(request(validBody({ email: "invalid" })))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" })
    expect(mocks.sendOperatorConsultationNotification).not.toHaveBeenCalled()
  })

  it("accepts an inquiry with only email as the required contact field", async () => {
    const response = await POST(request(validBody({ name: undefined })))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.sendOperatorConsultationNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationState: expect.objectContaining({
          contactEmail: "client@example.com",
          hasCustomerIdentity: false,
        }),
        fallback: expect.objectContaining({
          contactEmail: "client@example.com",
        }),
      }),
    )
  })

  it("skips duplicate operator email when the conversation already has the sent marker", async () => {
    mocks.hasSentOperatorNotification.mockReturnValueOnce(true)

    const response = await POST(request(validBody()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, emailSkipped: true })
    expect(mocks.appendMessage).toHaveBeenCalled()
    expect(mocks.sendOperatorConsultationNotification).not.toHaveBeenCalled()
  })

  it("keeps the UX successful when the operator notification sender fails", async () => {
    mocks.sendOperatorConsultationNotification.mockResolvedValueOnce({ status: "failed", reason: "send-failed" })

    const response = await POST(request(validBody()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, emailWarning: "send_failed" })
  })
})
