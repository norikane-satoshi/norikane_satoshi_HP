import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

function request(body: unknown, cookie?: string) {
  return new NextRequest("http://localhost/api/chatbot/audit-event", {
    method: "POST",
    body: JSON.stringify(body),
    headers: cookie ? { cookie } : undefined,
  })
}

const validEvent = {
  schemaVersion: "1",
  eventId: "22222222-2222-4222-8222-222222222222",
  eventName: "booking_card_rendered",
  correlationId: "11111111-1111-4111-8111-111111111111",
  conversationId: "conv_1",
  result: "success",
  uiKind: "booking-card",
}

async function loadPost(input: {
  conversationSessionId?: string
  recordStatus?: "created" | "duplicate"
} = {}) {
  vi.resetModules()
  const loadConversationById = vi.fn().mockResolvedValue({
    id: "conv_1",
    context: { sessionId: input.conversationSessionId ?? "session_1" },
    messages: [],
  })
  const recordChatbotAuditEvent = vi.fn().mockResolvedValue({
    status: input.recordStatus ?? "created",
  })

  vi.doMock("@/lib/chatbot/server/repository", () => ({ loadConversationById }))
  vi.doMock("@/lib/chatbot/audit/store", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/chatbot/audit/store")>()
    return { ...actual, recordChatbotAuditEvent }
  })

  const route = await import("./route")
  return { POST: route.POST, loadConversationById, recordChatbotAuditEvent }
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe("POST /api/chatbot/audit-event", () => {
  it("accepts an owned privacy-safe browser acknowledgement", async () => {
    const route = await loadPost()
    const response = await route.POST(request(validEvent, "chatbot_session_id=session_1"))

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({ accepted: true, duplicate: false })
    expect(route.recordChatbotAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: validEvent.eventId,
        conversationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        source: "browser",
      }),
    )
    expect(JSON.stringify(route.recordChatbotAuditEvent.mock.calls[0])).not.toContain("conv_1")
  })

  it("returns 401 without the HttpOnly session cookie", async () => {
    const route = await loadPost()
    const response = await route.POST(request(validEvent))

    expect(response.status).toBe(401)
    expect(route.loadConversationById).not.toHaveBeenCalled()
    expect(route.recordChatbotAuditEvent).not.toHaveBeenCalled()
  })

  it("returns 403 when the conversation belongs to a different session", async () => {
    const route = await loadPost({ conversationSessionId: "session_2" })
    const response = await route.POST(request(validEvent, "chatbot_session_id=session_1"))

    expect(response.status).toBe(403)
    expect(route.recordChatbotAuditEvent).not.toHaveBeenCalled()
  })

  it("rejects PII and message content at the schema boundary", async () => {
    const route = await loadPost()
    const response = await route.POST(
      request({ ...validEvent, customerEmail: "client@example.jp", message: "customer text" }, "chatbot_session_id=session_1"),
    )

    expect(response.status).toBe(400)
    expect(route.loadConversationById).not.toHaveBeenCalled()
    expect(route.recordChatbotAuditEvent).not.toHaveBeenCalled()
  })

  it("acknowledges a duplicate event id without creating a second fact", async () => {
    const route = await loadPost({ recordStatus: "duplicate" })
    const response = await route.POST(request(validEvent, "chatbot_session_id=session_1"))

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({ accepted: true, duplicate: true })
  })
})
