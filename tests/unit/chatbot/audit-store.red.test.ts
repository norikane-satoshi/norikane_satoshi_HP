import { describe, expect, it, vi } from "vitest"

import { chatbotStoredAuditEventSchema } from "@/lib/chatbot/audit/contract"
import {
  isChatbotConversationOwnedBySession,
  recordChatbotAuditEvent,
} from "@/lib/chatbot/audit/store"

const event = chatbotStoredAuditEventSchema.parse({
  schemaVersion: "1",
  eventId: "22222222-2222-4222-8222-222222222222",
  eventName: "booking_prefill_rendered",
  correlationId: "11111111-1111-4111-8111-111111111111",
  conversationHash: "a".repeat(64),
  source: "browser",
  sequence: 640,
  result: "success",
  uiKind: "booking-card",
  buildSha: "abc123",
  createdAt: "2026-08-20T00:00:00.000Z",
})

describe("chatbot canonical audit store", () => {
  it.each([
    ["session_1", "session_1", true],
    ["session_1:user_1", "session_1", true],
    ["session_1:anonymous", "session_1", true],
    ["session_10", "session_1", false],
    ["other:user_1", "session_1", false],
    ["session_1:unexpected:extra", "session_1", false],
  ])("checks session ownership without accepting prefix collisions", (conversationSessionId, cookieSessionId, expected) => {
    expect(isChatbotConversationOwnedBySession({ conversationSessionId, cookieSessionId })).toBe(expected)
  })

  it("stores one schema-validated event using only allowlisted columns", async () => {
    const create = vi.fn().mockResolvedValue({ eventId: event.eventId })

    await expect(
      recordChatbotAuditEvent(event, {
        client: { chatbotAuditEvent: { create } },
      }),
    ).resolves.toEqual({ status: "created" })

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: event.eventId,
        schemaVersion: "1",
        correlationId: event.correlationId,
        conversationHash: event.conversationHash,
        eventName: "booking_prefill_rendered",
        source: "browser",
        result: "success",
        uiKind: "booking-card",
        buildSha: "abc123",
        createdAt: new Date("2026-08-20T00:00:00.000Z"),
        payloadJson: expect.any(String),
      }),
    })
    const payload = JSON.parse(create.mock.calls[0][0].data.payloadJson)
    expect(chatbotStoredAuditEventSchema.parse(payload)).toEqual(event)
    expect(JSON.stringify(create.mock.calls[0][0].data)).not.toContain("conversationId")
  })

  it("treats a repeated event id as an idempotent duplicate", async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }))

    await expect(
      recordChatbotAuditEvent(event, {
        client: { chatbotAuditEvent: { create } },
      }),
    ).resolves.toEqual({ status: "duplicate" })
  })
})
