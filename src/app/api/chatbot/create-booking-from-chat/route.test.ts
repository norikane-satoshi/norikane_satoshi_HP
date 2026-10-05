import { bookingDetailLabels } from "@/lib/chatbot/domain/booking-details"
import { NextRequest } from "next/server"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-05-26T00:00:00Z")) })
afterEach(() => vi.useRealTimers())

function request(body: unknown, cookieSessionId = "session_1", headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/chatbot/create-booking-from-chat", {
    method: "POST",
    headers: { cookie: `chatbot_session_id=${cookieSessionId}`, ...headers },
    body: JSON.stringify(body),
  })
}

function validChatBooking(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "conv_1",
    projectTitle: "Color grading",
    contactName: "Satoshi",
    contactEmail: "client@example.com",
    companyName: "NCS",
    phone: "",
    dueDate: "2026-06-30",
    memo: "初回相談",
    confirmedDetails: bookingDetailLabels.map((label) => ({ label, value: "未確認" })),
    detailsConfirmed: true,
    agreed: true,
    selectedSlot: {
      start: "2026-06-10T01:00:00.000Z",
      end: "2026-06-10T02:00:00.000Z",
    },
    jobContext: { finalMedium: "web" },
    workflowEstimate: { totalMinDays: 2, totalMaxDays: 3 },
    correlationId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  }
}

async function loadPost(session: { user?: { id?: string; email?: string } } | null = null) {
  vi.resetModules()

  const prisma = {
    user: {
      upsert: vi.fn().mockResolvedValue({ id: "public_chatbot_user_1" }),
    },
  }
  const createBookingFromApiInput = vi.fn().mockResolvedValue({
    status: 200,
    body: {
      status: "ok",
      bookingGroupId: "group_1",
      bookingIds: ["slot_1"],
      bookingStatus: "CONFIRMED",
    },
  })
  const linkChatToBookingGroup = vi.fn().mockResolvedValue(undefined)
  const loadConversationById = vi.fn().mockResolvedValue({
    id: "conv_1",
    context: { sessionId: "session_1", slackThreadTs: "1700000000.000100" },
    messages: [],
  })
  const updateConversationSlackThreadTs = vi.fn().mockResolvedValue(undefined)
  const sendChatbotBookingOwnerNotification = vi.fn().mockResolvedValue({ skipped: false, id: "email_1" })
  const sendChatbotSlackNotification = vi.fn().mockResolvedValue({ status: "sent", ts: "1700000000.000200" })
  const auth = vi.fn().mockResolvedValue(session)
  const scheduleChatbotAuditPersistence = vi.fn()

  vi.doMock("@/auth", () => ({ auth }))
  vi.doMock("@/lib/prisma", () => ({ prisma }))
  vi.doMock("@/lib/booking/server/create-booking", () => ({ createBookingFromApiInput }))
  vi.doMock("@/lib/booking/server/email", () => ({ sendChatbotBookingOwnerNotification }))
  vi.doMock("@/lib/chatbot/server/repository", () => ({
    linkChatToBookingGroup,
    loadConversationById,
    updateConversationSlackThreadTs,
  }))
  vi.doMock("@/lib/chatbot/server/slack-notifier", async () => ({
    ...await vi.importActual<typeof import("@/lib/chatbot/server/slack-notifier")>(
      "@/lib/chatbot/server/slack-notifier",
    ),
    sendChatbotSlackNotification,
  }))
  vi.doMock("@/lib/chatbot/audit/scheduler", () => ({ scheduleChatbotAuditPersistence }))

  const route = await import("./route")
  return {
    POST: route.POST,
    prisma,
    createBookingFromApiInput,
    linkChatToBookingGroup,
    loadConversationById,
    updateConversationSlackThreadTs,
    sendChatbotBookingOwnerNotification,
    sendChatbotSlackNotification,
    auth,
    scheduleChatbotAuditPersistence,
  }
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe("POST /api/chatbot/create-booking-from-chat", () => {
  it("shares unconfirmed facts across the stored booking and owner notification, ignoring legacy inferred memo", async () => {
    const route = await loadPost()
    const response = await route.POST(request(validChatBooking({
      selectedSlot: undefined, attendanceDates: ["2026-10-13"], dueDate: "未定",
      confirmedDetails: undefined, detailsConfirmed: undefined,
      memo: "相談\n案件種別: 長編\n尺: 1時間\n最終媒体: 劇場",
      jobContext: { jobKind: "feature-90m", finalMedium: "cinema", projectLengthMinutes: 60 },
    })))
    expect(response.status).toBe(200)
    const memo = route.createBookingFromApiInput.mock.calls[0][0].input.memo
    expect(memo).toContain("案件種別: 未確認\n尺: 未確認\n最終媒体: 未確認")
    expect(memo).toContain("納品希望日: 未確認")
    expect(memo).not.toContain("1時間")
    expect(memo).not.toContain("長編")
    expect(route.sendChatbotBookingOwnerNotification).toHaveBeenCalledWith(expect.objectContaining({ memo }))
    expect(route.createBookingFromApiInput).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ requestedDates: [] }),
    }))
  })

  it("stores the customer's reviewed correction, without applying the old workflow estimate", async () => {
    const route = await loadPost()
    const response = await route.POST(request(validChatBooking({
      selectedSlot: undefined, attendanceDates: ["2026-10-13"], dueDate: "2026-10-25",
      confirmedDetails: [
        { label: "案件種別", value: "短編ドキュメンタリー" }, { label: "尺", value: "約18分（クレジット込み）" },
        { label: "最終媒体", value: "映画祭応募" }, { label: "納品形式", value: "ProRes 422 HQ（Rec.709）、DCP不要" },
      ], detailsConfirmed: true,
    })))
    expect(response.status).toBe(200)
    const memo = route.createBookingFromApiInput.mock.calls[0][0].input.memo
    expect(memo).toContain("尺: 約18分（クレジット込み）")
    expect(memo).toContain("納品希望日: 2026-10-25")
    expect(memo).toContain("納品形式: ProRes 422 HQ（Rec.709）、DCP不要")
    expect(memo).toContain("作業場所/立ち会い: 未確認")
    expect(route.sendChatbotBookingOwnerNotification).toHaveBeenCalledWith(expect.objectContaining({ memo }))
  })

  it.each([["0時間18分", "18分"], ["1時間18分", "1時間18分"], ["未定", "未確認"]])("shares reviewed duration %s with the booking and owner notification", async (value, canonical) => {
    const route = await loadPost()
    const response = await route.POST(request(validChatBooking({
      selectedSlot: undefined, attendanceDates: ["2026-10-13"], dueDate: "2026-10-25",
      confirmedDetails: [{ label: "尺", value }], detailsConfirmed: true,
    })))
    expect(response.status).toBe(200)
    const memo = route.createBookingFromApiInput.mock.calls[0][0].input.memo
    expect(memo).toContain(`尺: ${canonical}`)
    expect(route.sendChatbotBookingOwnerNotification).toHaveBeenCalledWith(expect.objectContaining({ memo }))
  })

  it("requires explicit confirmation for edited facts", async () => {
    const route = await loadPost()
    const response = await route.POST(request(validChatBooking({ confirmedDetails: [{ label: "尺", value: "18分" }], detailsConfirmed: undefined })))
    expect(response.status).toBe(400)
    expect(route.createBookingFromApiInput).not.toHaveBeenCalled()
  })
  it("rejects a booking link attempt for a conversation owned by another browser session", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validChatBooking(), "different_session"))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "conversation_not_owned" })
    expect(route.createBookingFromApiInput).not.toHaveBeenCalled()
    expect(route.linkChatToBookingGroup).not.toHaveBeenCalled()
  })

  it("links an authenticated chatbot booking to the customer's own account", async () => {
    const route = await loadPost({ user: { id: "customer_user_1", email: "owner@example.com" } })

    const response = await route.POST(request(validChatBooking()))

    expect(response.status).toBe(200)
    expect(route.prisma.user.upsert).not.toHaveBeenCalled()
    expect(route.createBookingFromApiInput).toHaveBeenCalledWith(expect.objectContaining({
      userId: "customer_user_1",
      userEmail: "client@example.com",
      originatedFrom: "chatbot",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    }))
    expect(route.scheduleChatbotAuditPersistence).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "booking_created", result: "success" }),
        expect.objectContaining({ eventName: "customer_account_linked", result: "success" }),
        expect.objectContaining({ eventName: "slack_notification_completed", result: "success" }),
      ]),
    )
  })

  it("accepts unauthenticated public chatbot booking submissions", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validChatBooking()))

    expect(response.status).toBe(200)
    expect(route.prisma.user.upsert).toHaveBeenCalledWith({
      where: { email: "chatbot-booking@norikane.studio" },
      update: { name: "Chatbot Public Booking" },
      create: {
        email: "chatbot-booking@norikane.studio",
        name: "Chatbot Public Booking",
      },
      select: { id: true },
    })
    expect(route.createBookingFromApiInput).toHaveBeenCalledWith({
      input: expect.objectContaining({
        sessionEmail: "client@example.com",
      }),
      notionTaskType: "仮押さえ",
      originatedFrom: "chatbot",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      userId: "public_chatbot_user_1",
      userEmail: "client@example.com",
    })
  })

  it("does not repeat owner email or Slack side effects for an idempotent booking replay", async () => {
    const route = await loadPost()
    route.createBookingFromApiInput.mockResolvedValue({
      status: 200,
      body: {
        status: "ok",
        bookingGroupId: "group_1",
        bookingIds: ["slot_1"],
        bookingStatus: "CONFIRMED",
        idempotentReplay: true,
      },
    })

    const response = await route.POST(request(validChatBooking()))

    expect(response.status).toBe(200)
    expect(route.sendChatbotBookingOwnerNotification).not.toHaveBeenCalled()
    expect(route.sendChatbotSlackNotification).not.toHaveBeenCalled()
    expect(route.scheduleChatbotAuditPersistence).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          eventName: "slack_notification_completed",
          result: "failure",
          errorCode: "idempotent-replay-notification-not-repeated",
        }),
      ]),
    )
  })

  it("returns 400 for an invalid body", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validChatBooking({ projectTitle: "" })))

    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error).toBe("invalid_request")
    expect(route.createBookingFromApiInput).not.toHaveBeenCalled()
  })

  it("returns 400 for an invalid contact email field", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validChatBooking({ contactEmail: "invalid-email" })))

    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error).toBe("invalid_request")
    expect(route.createBookingFromApiInput).not.toHaveBeenCalled()
    expect(route.sendChatbotBookingOwnerNotification).not.toHaveBeenCalled()
  })

  it("returns 400 when contact email is missing or empty", async () => {
    const route = await loadPost()

    const missingResponse = await route.POST(request(validChatBooking({ contactEmail: undefined })))
    expect(missingResponse.status).toBe(400)

    const emptyResponse = await route.POST(request(validChatBooking({ contactEmail: "" })))
    expect(emptyResponse.status).toBe(400)
    expect(route.createBookingFromApiInput).not.toHaveBeenCalled()
  })

  it("calls the shared booking service with the public chatbot identity and contact email", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validChatBooking()))

    expect(response.status).toBe(200)
    expect(route.createBookingFromApiInput).toHaveBeenCalledWith({
      input: expect.objectContaining({
        projectTitle: "Color grading",
        contactName: "Satoshi",
        sessionEmail: "client@example.com",
        selectedSlots: [
          {
            start: "2026-06-09T15:00:00.000Z",
            end: "2026-06-10T15:00:00.000Z",
          },
        ],
      }),
      notionTaskType: "仮押さえ",
      originatedFrom: "chatbot",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      userId: "public_chatbot_user_1",
      userEmail: "client@example.com",
    })
    expect(route.sendChatbotBookingOwnerNotification).toHaveBeenCalledWith(expect.objectContaining({
      contactEmail: "client@example.com",
      selectedSlots: [
        {
          start: "2026-06-09T15:00:00.000Z",
          end: "2026-06-10T15:00:00.000Z",
        },
      ],
    }))
  })

  it("accepts multiple selected slots from the chatbot calendar", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validChatBooking({
      selectedSlot: undefined,
      selectedSlots: [
        {
          start: "2026-06-10T15:00:00.000Z",
          end: "2026-06-11T15:00:00.000Z",
        },
        {
          start: "2026-06-12T15:00:00.000Z",
          end: "2026-06-13T15:00:00.000Z",
        },
      ],
    })))

    expect(response.status).toBe(200)
    expect(route.createBookingFromApiInput).toHaveBeenCalledWith({
      input: expect.objectContaining({
        selectedSlots: [
          {
            start: "2026-06-10T15:00:00.000Z",
            end: "2026-06-11T15:00:00.000Z",
          },
          {
            start: "2026-06-12T15:00:00.000Z",
            end: "2026-06-13T15:00:00.000Z",
          },
        ],
      }),
      notionTaskType: "仮押さえ",
      originatedFrom: "chatbot",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      userId: "public_chatbot_user_1",
      userEmail: "client@example.com",
    })
  })

  it("accepts zero selected slots as an unscheduled chatbot booking request", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validChatBooking({
      selectedSlot: undefined,
      selectedSlots: [],
    })))

    expect(response.status).toBe(200)
    expect(route.createBookingFromApiInput).toHaveBeenCalledWith({
      input: expect.objectContaining({
        projectTitle: "Color grading",
        contactName: "Satoshi",
        sessionEmail: "client@example.com",
        selectedSlots: [],
      }),
      notionTaskType: "仮押さえ",
      originatedFrom: "chatbot",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      userId: "public_chatbot_user_1",
      userEmail: "client@example.com",
    })
  })

  it("sends an owner notification for a chatbot booking submission", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validChatBooking({
      selectedSlot: undefined,
      selectedSlots: [
        {
          start: "2026-06-10T15:00:00.000Z",
          end: "2026-06-11T15:00:00.000Z",
        },
        {
          start: "2026-06-12T15:00:00.000Z",
          end: "2026-06-13T15:00:00.000Z",
        },
      ],
    })))

    expect(response.status).toBe(200)
    expect(route.sendChatbotBookingOwnerNotification).toHaveBeenCalledWith({
      bookingGroupId: "group_1",
      projectTitle: "Color grading",
      contactName: "Satoshi",
      contactEmail: "client@example.com",
      companyName: "NCS",
      memo: expect.stringContaining("案件種別: 未確認\n尺: 未確認\n最終媒体: 未確認"),
      selectedSlots: [
        {
          start: "2026-06-10T15:00:00.000Z",
          end: "2026-06-11T15:00:00.000Z",
        },
        {
          start: "2026-06-12T15:00:00.000Z",
          end: "2026-06-13T15:00:00.000Z",
        },
      ],
      submittedAt: expect.any(Date),
    })
    expect(route.sendChatbotBookingOwnerNotification.mock.calls[0][0].memo.endsWith("初回相談")).toBe(true)
  })

  it("returns the owner notification ID only in local development", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("VERCEL", "")
    vi.stubEnv("VERCEL_ENV", "development")
    const route = await loadPost()

    const response = await route.POST(request(validChatBooking()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      emailDebug: { chatbotOwnerNotificationId: "email_1" },
    })
  })

  it("does not return the owner notification ID outside local development", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("VERCEL", "1")
    vi.stubEnv("VERCEL_ENV", "production")
    const route = await loadPost()

    const response = await route.POST(request(validChatBooking()))
    const payload = await response.json()

    expect(payload).not.toHaveProperty("emailDebug")
  })

  it("keeps the booking response successful and logs when owner notification fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const route = await loadPost()
    route.sendChatbotBookingOwnerNotification.mockRejectedValueOnce(new Error("resend down"))

    const response = await route.POST(request(validChatBooking({
      selectedSlot: undefined,
      selectedSlots: [],
    })))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      ownerNotificationWarning: "send_failed",
    })
    expect(consoleError).toHaveBeenCalledWith(
      "[CHATBOT_OPERATION_FAILURE]",
      expect.stringContaining("\"stage\":\"notification-send\""),
    )
    consoleError.mockRestore()
  })

  it("links the conversation when conversationId is present", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validChatBooking()))

    expect(response.status).toBe(200)
    expect(route.linkChatToBookingGroup).toHaveBeenCalledWith({
      conversationId: "conv_1",
      bookingGroupId: "group_1",
    })
  })

  it("posts booking completion to the existing Slack thread", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validChatBooking()))

    expect(response.status).toBe(200)
    expect(route.sendChatbotSlackNotification).toHaveBeenCalledWith({
      kind: "booking-order-submitted",
      requestId: "11111111-1111-4111-8111-111111111111",
      conversationId: "conv_1",
      sessionId: "session_1",
      threadTs: "1700000000.000100",
      bookingGroupId: "group_1",
      selectedSlotCount: 1,
    })
    expect(route.updateConversationSlackThreadTs).not.toHaveBeenCalled()
  })

  it("maps shared conflict and calendar_unavailable statuses", async () => {
    const route = await loadPost()
    const { BookingConflictError } = await import("@/lib/booking/server/errors")
    route.createBookingFromApiInput.mockRejectedValueOnce(new BookingConflictError("slot_taken"))

    const conflictResponse = await route.POST(request(validChatBooking({ conversationId: undefined })))

    expect(conflictResponse.status).toBe(409)
    await expect(conflictResponse.json()).resolves.toEqual({
      error: "slot_taken",
      requestId: "11111111-1111-4111-8111-111111111111",
    })

    route.createBookingFromApiInput.mockResolvedValueOnce({
      status: 502,
      body: { error: "calendar_unavailable", bookingGroupId: "group_2" },
    })

    const calendarResponse = await route.POST(request(validChatBooking({ conversationId: undefined })))

    expect(calendarResponse.status).toBe(502)
    await expect(calendarResponse.json()).resolves.toEqual({
      error: "calendar_unavailable",
      bookingGroupId: "group_2",
      requestId: "11111111-1111-4111-8111-111111111111",
    })
  })

  it("keeps a check conversation's booking out of Slack while a manual or customer booking still posts", async () => {
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN", "worker-secret")
    const { chatbotDiagnosticHeader, chatbotDiagnosticToken } = await import("@/lib/chatbot/server/diagnostic-request")
    const diagnostic = await loadPost()

    const response = await diagnostic.POST(
      request(validChatBooking(), "session_1", { [chatbotDiagnosticHeader]: chatbotDiagnosticToken()! }),
    )

    expect(response.status).toBe(200)
    expect(diagnostic.sendChatbotSlackNotification).not.toHaveBeenCalled()
    const auditEvents = diagnostic.scheduleChatbotAuditPersistence.mock.calls.flatMap(([events]) => events)
    expect(auditEvents).toContainEqual(
      expect.objectContaining({ eventName: "slack_notification_completed", errorCode: "slack-skipped-diagnostic" }),
    )

    const manual = await loadPost()
    await manual.POST(request(validChatBooking(), "session_1", { [chatbotDiagnosticHeader]: "not-the-token" }))
    expect(manual.sendChatbotSlackNotification).toHaveBeenCalled()
  })

  it("holds only selected dates and ignores legacy estimates", async () => {
    const route = await loadPost()
    const response = await route.POST(request(validChatBooking({
      selectedSlot: undefined,
      selectedSlots: [{ start: "2026-10-13", end: "2026-10-17" }],
      dueDate: "2026-10-30",
      attendanceDates: ["2026-10-14"],
      workflowEstimate: { totalMinDays: 4, totalMaxDays: 5 },
    })))
    expect(response.status).toBe(200)
    const args = route.createBookingFromApiInput.mock.calls[0][0]
    expect(args.input.selectedSlots).toEqual([{ start: "2026-10-12T15:00:00.000Z", end: "2026-10-13T15:00:00.000Z" }])
    expect(args).not.toHaveProperty("scheduleLines")
    expect(args).not.toHaveProperty("requestedDateLabels")
    expect(args.input).not.toHaveProperty("workflowEstimate")
    expect(route.sendChatbotBookingOwnerNotification.mock.calls[0][0]).not.toHaveProperty("scheduleLines")
  })
})


it.each(["", "相談したい", "2026-02-30"])("rejects a deadline without a date or explicit undecided selection: %s", async (dueDate) => {
  const route = await loadPost()
  const response = await route.POST(request(validChatBooking({ dueDate })))
  expect(response.status).toBe(400)
  expect(route.createBookingFromApiInput).not.toHaveBeenCalled()
})
