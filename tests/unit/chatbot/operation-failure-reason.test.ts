import { describe, expect, it } from "vitest"

import { buildChatbotOperationFailureAuditEvent, describeFailureForAudit } from "@/lib/chatbot/audit/server-evidence"

describe("operation failure reason in the audit row", () => {
  it("keeps an error code message and the innermost named function", () => {
    const error = new Error("chatbot_message_audit_evidence_missing")
    error.stack = "Error: chatbot_message_audit_evidence_missing\n    at POST (/var/task/route.js:1:2)\n    at async run (/var/task/x.js:3:4)"

    expect(describeFailureForAudit(error)).toBe("chatbot_message_audit_evidence_missing:POST")
  })

  it("never records message text, only the error type", () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'client@example.com')")
    error.stack = "TypeError: Cannot read properties\n    at buildAssistantDisplayContent (/var/task/h.js:1:2)"

    const reason = describeFailureForAudit(error)
    expect(reason).toBe("TypeError:buildAssistantDisplayContent")
    expect(reason).not.toContain("example")
  })

  it("stores the reason on the operation_failed event", () => {
    const event = buildChatbotOperationFailureAuditEvent({
      requestId: "eb216d2b-23e1-49d0-9e4b-ddaec0fcfc22",
      conversationId: "conv_1",
      buildSha: "abc",
      createdAt: "2026-09-27T00:00:00.000Z",
      errorCode: "message-server-handler-failed",
      errorReason: "TypeError:buildAssistantDisplayContent",
      durationMs: 10,
    })

    expect(event).toMatchObject({ errorReason: "TypeError:buildAssistantDisplayContent" })
  })
})
