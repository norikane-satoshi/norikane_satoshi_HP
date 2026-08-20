import { describe, expect, it } from "vitest"

import { evaluateChatbotAuditCompleteness } from "@/lib/chatbot/audit/completeness"

function event(eventName: string, result: "success" | "failure" = "success", uiKind?: string) {
  return { eventName, result, ...(uiKind ? { uiKind } : {}) }
}

describe("chatbot audit completeness", () => {
  it("requires both booking render acknowledgements for a booking response", () => {
    const result = evaluateChatbotAuditCompleteness([
      event("request_received"),
      event("response_normalized", "success", "booking-card"),
      event("conversation_persisted"),
      event("slack_notification_completed"),
      event("booking_card_rendered"),
    ])

    expect(result).toEqual({
      status: "pending",
      eventCount: 5,
      missingEvents: ["booking_prefill_rendered"],
      failedEvents: [],
    })
  })

  it("reports complete only when the server and browser contracts are all present", () => {
    const result = evaluateChatbotAuditCompleteness([
      event("request_received"),
      event("response_normalized", "success", "choice-panel"),
      event("conversation_persisted"),
      event("slack_notification_completed"),
      event("choice_panel_rendered"),
    ])

    expect(result.status).toBe("complete")
    expect(result.missingEvents).toEqual([])
  })

  it("fails closed when any recorded boundary failed", () => {
    const result = evaluateChatbotAuditCompleteness([
      event("request_received"),
      event("response_normalized", "success", "none"),
      event("conversation_persisted"),
      event("slack_notification_completed", "failure"),
    ])

    expect(result).toMatchObject({
      status: "failed",
      failedEvents: ["slack_notification_completed"],
    })
  })
})
