import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

function request(body: unknown) {
  return new NextRequest("http://localhost/api/chatbot/create-booking-from-chat", {
    method: "POST",
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
    agreed: true,
    selectedSlot: {
      start: "2026-06-10T01:00:00.000Z",
      end: "2026-06-10T02:00:00.000Z",
    },
    jobContext: { finalMedium: "web" },
    workflowEstimate: { totalMinDays: 2, totalMaxDays: 3 },
    ...overrides,
  }
}

async function loadPost() {
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

  vi.doMock("@/lib/prisma", () => ({ prisma }))
  vi.doMock("@/lib/booking/server/create-booking", () => ({ createBookingFromApiInput }))
  vi.doMock("@/lib/booking/server/email", () => ({ sendChatbotBookingOwnerNotification }))
  vi.doMock("@/lib/chatbot/server/repository", () => ({
    linkChatToBookingGroup,
    loadConversationById,
    updateConversationSlackThreadTs,
  }))
  vi.doMock("@/lib/chatbot/server/slack-notifier", () => ({ sendChatbotSlackNotification }))

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
  }
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe("POST /api/chatbot/create-booking-from-chat", () => {
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
      userId: "public_chatbot_user_1",
      userEmail: "client@example.com",
    })
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
            start: "2026-06-10T01:00:00.000Z",
            end: "2026-06-10T02:00:00.000Z",
          },
        ],
      }),
      notionTaskType: "仮押さえ",
      originatedFrom: "chatbot",
      userId: "public_chatbot_user_1",
      userEmail: "client@example.com",
    })
    expect(route.sendChatbotBookingOwnerNotification).toHaveBeenCalledWith(expect.objectContaining({
      contactEmail: "client@example.com",
      selectedSlots: [
        {
          start: "2026-06-10T01:00:00.000Z",
          end: "2026-06-10T02:00:00.000Z",
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
      memo: "初回相談",
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
      kind: "booking-completed",
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
    await expect(conflictResponse.json()).resolves.toEqual({ error: "slot_taken" })

    route.createBookingFromApiInput.mockResolvedValueOnce({
      status: 502,
      body: { error: "calendar_unavailable", bookingGroupId: "group_2" },
    })

    const calendarResponse = await route.POST(request(validChatBooking({ conversationId: undefined })))

    expect(calendarResponse.status).toBe(502)
    await expect(calendarResponse.json()).resolves.toEqual({
      error: "calendar_unavailable",
      bookingGroupId: "group_2",
    })
  })
})
