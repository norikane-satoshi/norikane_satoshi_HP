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

    expect(warn).toHaveBeenCalledWith("[email skipped] tag=tentative_hold to=satoshi@example.com")
    expect(mocks.Resend).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("sends tentative hold customer mail with custom sender and escaped HTML", async () => {
    process.env.RESEND_API_KEY = "resend_key"
    process.env.RESEND_FROM_EMAIL = "booking@norikane.studio"
    mocks.send.mockResolvedValue({ data: { id: "email_1" }, error: null })
    const { sendBookingConfirmedEmail, getResendClient } = await import("@/lib/booking/server/email")

    await expect(sendBookingConfirmedEmail({
      to: "client@example.com",
      projectTitle: "<Project>",
      selectedSlots: [
        {
          start: new Date("2026-06-10T01:00:00.000Z"),
          end: new Date("2026-06-10T02:00:00.000Z"),
        },
      ],
      bookingGroupId: "group_1",
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
      subject: expect.stringContaining("【仮キープ受付】<Project>"),
      text: expect.stringContaining("grading / online\ndetail & note"),
      html: expect.stringContaining("&lt;Project&gt;"),
    }))
    const message = mocks.send.mock.calls[0][0]
    expect(message.text).toEqual(expect.stringContaining("仮キープ受付として内容をお預かりしました"))
    expect(message.text).toEqual(expect.stringContaining("後ほど則兼本人から直接ご連絡します"))
    expect(message.text).toEqual(expect.stringContaining("仮キープ候補日:"))
    expect(message.text).toEqual(expect.stringContaining("予約番号: group_1"))
    expect(message.subject).not.toMatch(/予約確定|本予約として確定|確定しました/)
    expect(message.text).not.toMatch(/予約確定|本予約として確定|確定しました/)
  })

  it("marks zero selected dates as an unscheduled tentative consultation in customer mail", async () => {
    process.env.RESEND_API_KEY = "resend_key"
    mocks.send.mockResolvedValue({ data: { id: "email_zero_1" }, error: null })
    const { sendBookingConfirmedEmail } = await import("@/lib/booking/server/email")

    await sendBookingConfirmedEmail({
      to: "client@example.com",
      projectTitle: "Schedule later",
      selectedSlots: [],
      bookingGroupId: "group_zero",
      workScopes: [],
      otherWorkDetail: "",
      estimatedDuration: "consult",
    })

    const message = mocks.send.mock.calls[0][0]
    expect(message.subject).toContain("【仮キープ受付】Schedule later")
    expect(message.subject).toContain("候補日未選択")
    expect(message.text).toContain("候補日: 候補日未選択（候補日未選択の相談として受け付けました）")
    expect(message.text).toContain("日程は後ほど相談させてください")
    expect(message.text).toContain("後ほど則兼本人から直接ご連絡します")
    expect(message.subject).not.toMatch(/予約確定|本予約として確定|確定しました/)
    expect(message.text).not.toMatch(/予約確定|本予約として確定|確定しました/)
  })

  it("summarizes requested date ranges as consultation dates in customer mail", async () => {
    process.env.RESEND_API_KEY = "resend_key"
    mocks.send.mockResolvedValue({ data: { id: "email_date_range_1" }, error: null })
    const { sendBookingConfirmedEmail } = await import("@/lib/booking/server/email")

    await sendBookingConfirmedEmail({
      to: "client@example.com",
      projectTitle: "Date request",
      selectedSlots: [],
      requestedDateRange: { startDate: "2026-07-10", endDate: "2026-07-12" },
      bookingGroupId: "group_date_range",
      workScopes: [],
      otherWorkDetail: "",
      estimatedDuration: "consult",
    })

    const message = mocks.send.mock.calls[0][0]
    expect(message.subject).toContain("【仮キープ受付】Date request")
    expect(message.subject).toContain("3日間")
    expect(message.text).toContain("相談希望日:")
    expect(message.text).toContain("2026/07/10")
    expect(message.text).toContain("2026/07/12")
    expect(message.text).toContain("確定予約ではなく、相談希望日としてお預かりしています")
    expect(message.subject).not.toMatch(/予約確定|本予約として確定|確定しました/)
    expect(message.text).not.toMatch(/予約確定|本予約として確定|確定しました/)
  })

  it("summarizes multiple non-contiguous selected dates as tentative candidates in customer mail", async () => {
    process.env.RESEND_API_KEY = "resend_key"
    mocks.send.mockResolvedValue({ data: { id: "email_multi_1" }, error: null })
    const { sendBookingConfirmedEmail } = await import("@/lib/booking/server/email")

    await sendBookingConfirmedEmail({
      to: "client@example.com",
      projectTitle: "Multi dates",
      selectedSlots: [
        { start: "2026-06-10T01:00:00.000Z", end: "2026-06-10T02:00:00.000Z" },
        { start: "2026-06-17T03:00:00.000Z", end: "2026-06-17T04:00:00.000Z" },
        { start: "2026-06-25T05:00:00.000Z", end: "2026-06-25T06:00:00.000Z" },
      ],
      bookingGroupId: "group_multi",
      workScopes: [],
      otherWorkDetail: "memo",
      estimatedDuration: "consult",
    })

    const message = mocks.send.mock.calls[0][0]
    expect(message.subject).toContain("3件の仮キープ候補")
    expect(message.text).toContain("仮キープ候補日:")
    expect(message.text).toContain("2026/06/10")
    expect(message.text).toContain("2026/06/17")
    expect(message.text).toContain("2026/06/25")
    expect(message.text).toContain("選択された日程は実施日ではなく、仮キープ候補としてお預かりしています。")
    expect(message.text).toContain("後ほど則兼本人から直接ご連絡します")
    expect(message.subject).not.toMatch(/予約確定|本予約として確定|確定しました/)
    expect(message.text).not.toMatch(/予約確定|本予約として確定|確定しました/)
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

  it("summarizes requested date ranges in owner notification", async () => {
    process.env.RESEND_API_KEY = "resend_key"
    process.env.CHATBOT_BOOKING_OWNER_EMAIL = "owner@example.com"
    mocks.send.mockResolvedValue({ data: { id: "email_owner_3" }, error: null })
    const { sendChatbotBookingOwnerNotification } = await import("@/lib/booking/server/email")

    await sendChatbotBookingOwnerNotification({
      bookingGroupId: "group_3",
      projectTitle: "Date range",
      contactName: "田中",
      contactEmail: "client@example.com",
      selectedSlots: [],
      requestedDateRange: { startDate: "2026-07-10", endDate: "2026-07-12" },
    })

    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@example.com",
      text: expect.stringContaining("候補日: 2026/07/10"),
    }))
    expect(mocks.send.mock.calls[0][0].text).toContain("2026/07/12")
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
