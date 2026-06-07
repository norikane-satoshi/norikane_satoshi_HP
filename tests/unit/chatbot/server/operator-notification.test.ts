import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getResendClient: vi.fn(),
  send: vi.fn(),
}))

vi.mock("@/lib/booking/server/email", () => ({
  getResendClient: mocks.getResendClient,
}))

describe("operator consultation notification", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it("safely skips when Resend is not configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.getResendClient.mockReturnValue(null)
    const { sendOperatorConsultationNotification } = await import("@/lib/chatbot/server/operator-notification")

    await expect(sendOperatorConsultationNotification({ trigger: "chat-completed" })).resolves.toEqual({
      status: "skipped",
      reason: "missing-resend-api-key",
    })

    expect(warn).toHaveBeenCalledWith("[chatbot operator email skipped] to=norikane.satoshi@gmail.com")
    expect(mocks.send).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("sends to the fixed operator address with customer replyTo", async () => {
    vi.stubEnv("RESEND_FROM_EMAIL", "noreply@norikane.studio")
    mocks.getResendClient.mockReturnValue({ emails: { send: mocks.send } })
    mocks.send.mockResolvedValue({ data: { id: "email_1" }, error: null })
    const { sendOperatorConsultationNotification } = await import("@/lib/chatbot/server/operator-notification")

    await expect(
      sendOperatorConsultationNotification({
        trigger: "chat-completed",
        jobContext: {
          finalMedium: "web",
          jobKind: "cm-30s",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
        },
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasProjectLength: true,
          hasAdditionalWork: false,
          hasDocumentaryAttachments: true,
          hasWorkSite: true,
          hasContactEmail: true,
          hasDesiredSchedule: true,
          contactEmail: "client@example.com",
          customerName: "田中",
          turnCount: 5,
        },
      }),
    ).resolves.toEqual({ status: "sent", id: "email_1" })

    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "のりかね映像設計室 <noreply@norikane.studio>",
        to: "norikane.satoshi@gmail.com",
        replyTo: "client@example.com",
        subject: "【チャットボット相談完了通知】田中 様",
        text: expect.stringContaining("相談サマリ"),
      }),
    )
  })
})
