import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  Resend: vi.fn(),
  send: vi.fn(),
}))

vi.mock("resend", () => ({
  Resend: mocks.Resend,
}))

describe("booking email sender", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.RESEND_API_KEY
    delete process.env.RESEND_FROM_EMAIL
    mocks.Resend.mockImplementation(function Resend() {
      return {
        emails: { send: mocks.send },
      }
    })
  })

  it("skips sending when Resend is not configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { sendBookingConfirmedEmail } = await import("@/lib/booking/server/email")

    await expect(sendBookingConfirmedEmail({
      to: "satoshi@example.com",
      projectTitle: "Project",
      start: "2026-06-10T01:00:00.000Z",
      end: "2026-06-10T02:00:00.000Z",
      workScopes: [],
      otherWorkDetail: "",
      estimatedDuration: "consult",
    })).resolves.toEqual({ skipped: true })

    expect(warn).toHaveBeenCalledWith("[email skipped] tag=confirmed to=satoshi@example.com")
    expect(mocks.Resend).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("sends confirmed booking mail with custom sender and escaped HTML", async () => {
    process.env.RESEND_API_KEY = "resend_key"
    process.env.RESEND_FROM_EMAIL = "booking@norikane.studio"
    mocks.send.mockResolvedValue({ data: { id: "email_1" }, error: null })
    const { sendBookingConfirmedEmail, getResendClient } = await import("@/lib/booking/server/email")

    await expect(sendBookingConfirmedEmail({
      to: "client@example.com",
      projectTitle: "<Project>",
      start: new Date("2026-06-10T01:00:00.000Z"),
      end: new Date("2026-06-10T02:00:00.000Z"),
      workScopes: ["grading", "online"],
      otherWorkDetail: "detail & note",
      estimatedDuration: "consult",
    })).resolves.toEqual({ skipped: false, id: "email_1" })

    expect(getResendClient()).toBe(getResendClient())
    expect(mocks.Resend).toHaveBeenCalledTimes(1)
    expect(mocks.Resend).toHaveBeenCalledWith("resend_key")
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      from: "のりかね映像設計室 <booking@norikane.studio>",
      to: "client@example.com",
      subject: expect.stringContaining("【予約確定】<Project>"),
      text: expect.stringContaining("grading / online\ndetail & note"),
      html: expect.stringContaining("&lt;Project&gt;"),
    }))
  })

  it("sends chatbot booking owner notification to the default owner with selected slots", async () => {
    process.env.RESEND_API_KEY = "resend_key"
    process.env.RESEND_FROM_EMAIL = "booking@norikane.studio"
    mocks.send.mockResolvedValue({ data: { id: "email_owner_1" }, error: null })
    const { sendChatbotBookingOwnerNotification } = await import("@/lib/booking/server/email")

    await expect(sendChatbotBookingOwnerNotification({
      bookingGroupId: "group_1",
      projectTitle: "<Color grading>",
      contactName: "田中",
      contactEmail: "client@example.com",
      companyName: "Example Inc.",
      memo: "補足 & note",
      selectedSlots: [
        {
          start: "2026-06-10T01:00:00.000Z",
          end: "2026-06-10T02:00:00.000Z",
        },
        {
          start: "2026-06-12T01:00:00.000Z",
          end: "2026-06-12T02:00:00.000Z",
        },
      ],
      submittedAt: "2026-06-21T12:00:00.000Z",
    })).resolves.toEqual({ skipped: false, id: "email_owner_1" })

    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      from: "のりかね映像設計室 <booking@norikane.studio>",
      to: "norikane.satoshi@gmail.com",
      replyTo: "client@example.com",
      subject: "【チャットボット予約通知】<Color grading>",
      text: expect.stringContaining("経由: HPチャットボット Booking Order"),
      html: expect.stringContaining("&lt;Color grading&gt;"),
    }))
    expect(mocks.send.mock.calls[0][0].text).toEqual(expect.stringContaining("予約番号: group_1"))
    expect(mocks.send.mock.calls[0][0].text).toEqual(expect.stringContaining("候補日: 2026/06/10"))
    expect(mocks.send.mock.calls[0][0].text).toEqual(expect.stringContaining("2026/06/12"))
  })

  it("marks chatbot booking owner notification as unscheduled when no slots are selected", async () => {
    process.env.RESEND_API_KEY = "resend_key"
    process.env.CHATBOT_BOOKING_OWNER_EMAIL = "owner@example.com"
    mocks.send.mockResolvedValue({ data: { id: "email_owner_2" }, error: null })
    const { sendChatbotBookingOwnerNotification } = await import("@/lib/booking/server/email")

    await sendChatbotBookingOwnerNotification({
      bookingGroupId: "group_2",
      projectTitle: "Schedule later",
      contactName: "田中",
      contactEmail: "client@example.com",
      selectedSlots: [],
    })

    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@example.com",
      text: expect.stringContaining("候補日: 候補日未選択"),
    }))
    delete process.env.CHATBOT_BOOKING_OWNER_EMAIL
  })

  it("raises Resend errors", async () => {
    process.env.RESEND_API_KEY = "resend_key"
    mocks.send.mockResolvedValue({ data: null, error: { message: "rate limited" } })
    const { sendBookingConfirmedEmail } = await import("@/lib/booking/server/email")

    await expect(sendBookingConfirmedEmail({
      to: "client@example.com",
      projectTitle: "Project",
      start: "2026-06-10T01:00:00.000Z",
      end: "2026-06-10T02:00:00.000Z",
      workScopes: ["grading"],
    })).rejects.toThrow("Resend send failed: rate limited")
  })
})
