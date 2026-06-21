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

async function loadPost(session: { user?: { id?: string; email?: string } } | null = {
  user: { id: "user_1", email: "satoshi@example.com" },
}) {
  vi.resetModules()

  const auth = vi.fn().mockResolvedValue(session)
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

  vi.doMock("@/auth", () => ({ auth }))
  vi.doMock("@/lib/booking/server/create-booking", () => ({ createBookingFromApiInput }))
  vi.doMock("@/lib/chatbot/server/repository", () => ({ linkChatToBookingGroup }))

  const route = await import("./route")
  return {
    POST: route.POST,
    auth,
    createBookingFromApiInput,
    linkChatToBookingGroup,
  }
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe("POST /api/chatbot/create-booking-from-chat", () => {
  it("returns 401 when unauthenticated", async () => {
    const route = await loadPost(null)

    const response = await route.POST(request(validChatBooking()))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
    expect(route.createBookingFromApiInput).not.toHaveBeenCalled()
  })

  it("returns 400 for an invalid body", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validChatBooking({ projectTitle: "" })))

    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error).toBe("invalid_request")
    expect(route.createBookingFromApiInput).not.toHaveBeenCalled()
  })

  it("calls the shared booking service with the session email", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validChatBooking()))

    expect(response.status).toBe(200)
    expect(route.createBookingFromApiInput).toHaveBeenCalledWith({
      input: expect.objectContaining({
        projectTitle: "Color grading",
        contactName: "Satoshi",
        sessionEmail: "satoshi@example.com",
        selectedSlots: [
          {
            start: "2026-06-10T01:00:00.000Z",
            end: "2026-06-10T02:00:00.000Z",
          },
        ],
      }),
      userId: "user_1",
      userEmail: "satoshi@example.com",
    })
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
      userId: "user_1",
      userEmail: "satoshi@example.com",
    })
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
