import { afterEach, describe, expect, it, vi } from "vitest"

import { logChatbotOperationFailure } from "@/lib/chatbot/server/operation-failure"

describe("chatbot operation failure log privacy", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("retains machine-actionable facts without ids, user agent, exception text, or stack", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    logChatbotOperationFailure({
      operation: "message",
      stage: "conversation-save",
      requestId: "11111111-1111-4111-8111-111111111111",
      error: new Error("client@example.jp secret customer sentence"),
      requestSummary: {
        conversationId: "conversation_private_1",
        clientSessionId: "session_private_1",
        userAgent: "Mozilla/5.0 private-device",
        messageLength: 42,
        hasEditTargetMessageId: true,
        dbWrite: "updateConversationRouting",
      },
    })

    const serialized = String(consoleError.mock.calls[0]?.[1])
    const payload = JSON.parse(serialized)
    expect(payload).toMatchObject({
      requestId: "11111111-1111-4111-8111-111111111111",
      operation: "message",
      stage: "conversation-save",
      requestSummary: {
        messageLength: 42,
        hasEditTargetMessageId: true,
        dbWrite: "updateConversationRouting",
      },
      error: { name: "Error" },
    })
    for (const forbidden of [
      "client@example.jp",
      "secret customer sentence",
      "conversation_private_1",
      "session_private_1",
      "private-device",
      "stack",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})
