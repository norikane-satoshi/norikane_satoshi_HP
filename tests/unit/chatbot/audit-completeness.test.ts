import { describe, expect, it } from "vitest"

import { evaluateChatbotAuditCompleteness } from "@/lib/chatbot/audit/completeness"

function event(
  eventName: string,
  result: "success" | "failure" = "success",
  input: Record<string, unknown> = {},
) {
  const retry = typeof input.retryAttempt === "number" ? input.retryAttempt : 1
  const defaultSequences: Record<string, number> = {
    request_received: 100,
    notion_thread_hidden_verified: 250 + retry,
    response_normalized: 300,
    conversation_persisted: 400,
    slack_notification_completed: 500,
    choice_panel_rendered: 620,
    booking_card_rendered: 630,
    booking_prefill_rendered: 640,
    fallback_ui_rendered: 650,
    booking_created: 700,
    customer_account_linked: 710,
    booking_submit_success_rendered: 800,
  }
  const sequence = eventName === "tier_attempt_completed"
    ? (input.phase === "health-check" ? 150 : 200) + retry
    : defaultSequences[eventName]
  const slackDeliveryEvidence = eventName === "slack_notification_completed" && result === "success"
    ? {
        deliveries: [{
          kind: "conversation",
          idempotencyKeyHash: "a".repeat(64),
          providerDedupeKeySubmitted: true,
          providerMessageTsPresent: true,
        }],
        uniqueIdempotencyKeys: true,
      }
    : undefined
  return { eventName, result, sequence, ...(slackDeliveryEvidence ? { slackDeliveryEvidence } : {}), ...input }
}

describe("chatbot audit completeness", () => {
  it("accepts a recorded same-tier deterministic repair only when its repaired success follows", () => {
    const result = evaluateChatbotAuditCompleteness([
      event("request_received"),
      event("tier_attempt_completed", "failure", {
        tier: "tier-1-hosted-chrome-notion-ai",
        phase: "generate",
        retryAttempt: 1,
      }),
      event("tier_attempt_completed", "failure", {
        tier: "tier-2-gemini-flash",
        phase: "generate",
        retryAttempt: 2,
        errorCode: "invalid-output",
        errorReason: "choice-set-choice-count-out-of-range",
        repairAttempted: true,
      }),
      event("tier_attempt_completed", "success", {
        tier: "tier-2-gemini-flash",
        phase: "generate",
        retryAttempt: 3,
        repairAttempted: true,
      }),
      event("response_normalized", "success", {
        tier: "tier-2-gemini-flash",
        uiKind: "choice-panel",
        finalTierConsistent: true,
        tierSequenceValid: true,
      }),
      event("conversation_persisted"),
      event("slack_notification_completed"),
      event("choice_panel_rendered"),
    ])

    expect(result).toMatchObject({
      status: "complete",
      failedEvents: [],
      integrityViolations: [],
    })
  })

  it("requires both booking render acknowledgements for a booking response", () => {
    const result = evaluateChatbotAuditCompleteness([
      event("request_received"),
      event("tier_attempt_completed", "failure", {
        tier: "tier-1-hosted-chrome-notion-ai",
        phase: "generate",
        retryAttempt: 1,
      }),
      event("tier_attempt_completed", "success", {
        tier: "tier-2-gemini-flash",
        phase: "generate",
        retryAttempt: 2,
      }),
      event("response_normalized", "success", {
        tier: "tier-2-gemini-flash",
        uiKind: "booking-card",
        finalTierConsistent: true,
        tierSequenceValid: true,
      }),
      event("conversation_persisted"),
      event("slack_notification_completed"),
      event("booking_card_rendered"),
    ])

    expect(result).toEqual({
      status: "pending",
      eventCount: 7,
      missingEvents: ["booking_prefill_rendered"],
      failedEvents: [],
      duplicateEvents: [],
      integrityViolations: [],
    })
  })

  it("reports complete only when the server and browser contracts are all present", () => {
    const result = evaluateChatbotAuditCompleteness([
      event("request_received", "success", { sequence: 100 }),
      event("tier_attempt_completed", "success", {
        sequence: 201,
        tier: "tier-1-hosted-chrome-notion-ai",
        phase: "generate",
        retryAttempt: 1,
        threadEvidence: {
          hiddenFromChatList: true,
          hideVerificationResult: "verified",
          postHideInferenceVerified: true,
        },
      }),
      event("notion_thread_hidden_verified", "success", { sequence: 251 }),
      event("response_normalized", "success", {
        sequence: 300,
        tier: "tier-1-hosted-chrome-notion-ai",
        uiKind: "choice-panel",
        fallbackUsed: false,
        finalTierConsistent: true,
        tierSequenceValid: true,
      }),
      event("conversation_persisted", "success", { sequence: 400 }),
      event("slack_notification_completed", "success", { sequence: 500 }),
      event("choice_panel_rendered", "success", { sequence: 620 }),
    ])

    expect(result.status).toBe("complete")
    expect(result.missingEvents).toEqual([])
  })

  it("fails closed when any recorded boundary failed", () => {
    const result = evaluateChatbotAuditCompleteness([
      event("request_received"),
      event("tier_attempt_completed", "failure", {
        tier: "tier-1-hosted-chrome-notion-ai",
        phase: "generate",
        retryAttempt: 1,
      }),
      event("tier_attempt_completed", "success", {
        tier: "tier-2-gemini-flash",
        phase: "generate",
        retryAttempt: 2,
      }),
      event("response_normalized", "success", {
        tier: "tier-2-gemini-flash",
        uiKind: "none",
        finalTierConsistent: true,
        tierSequenceValid: true,
      }),
      event("conversation_persisted"),
      event("slack_notification_completed", "failure"),
    ])

    expect(result).toMatchObject({
      status: "failed",
      failedEvents: ["slack_notification_completed"],
    })
  })

  it("fails closed when Tier evidence is missing or a Tier 1 thread was not hidden", () => {
    const missingAttempt = evaluateChatbotAuditCompleteness([
      event("request_received"),
      event("response_normalized", "success", {
        tier: "tier-1-hosted-chrome-notion-ai",
        uiKind: "none",
        finalTierConsistent: true,
        tierSequenceValid: true,
      }),
      event("conversation_persisted"),
      event("slack_notification_completed"),
    ])
    expect(missingAttempt.status).toBe("pending")
    expect(missingAttempt.missingEvents).toContain("tier_attempt_completed")

    const missingHide = evaluateChatbotAuditCompleteness([
      event("request_received"),
      event("tier_attempt_completed", "success", {
        tier: "tier-1-hosted-chrome-notion-ai",
        phase: "generate",
        retryAttempt: 1,
      }),
      event("response_normalized", "success", {
        tier: "tier-1-hosted-chrome-notion-ai",
        uiKind: "none",
        finalTierConsistent: true,
        tierSequenceValid: true,
      }),
      event("conversation_persisted"),
      event("slack_notification_completed"),
    ])
    expect(missingHide.missingEvents).toContain("notion_thread_hidden_verified")
  })

  it("rejects duplicate singleton boundaries, invalid order, and invalid Tier sequence", () => {
    const result = evaluateChatbotAuditCompleteness([
      event("response_normalized", "success", {
        sequence: 50,
        tier: "tier-2-gemini-flash",
        uiKind: "none",
        finalTierConsistent: true,
        tierSequenceValid: false,
      }),
      event("request_received", "success", { sequence: 100 }),
      event("request_received", "success", { sequence: 100 }),
      event("tier_attempt_completed", "failure", {
        sequence: 201,
        tier: "tier-1-hosted-chrome-notion-ai",
        phase: "generate",
        retryAttempt: 1,
      }),
      event("tier_attempt_completed", "success", {
        sequence: 202,
        tier: "tier-2-gemini-flash",
        phase: "generate",
        retryAttempt: 2,
      }),
      event("conversation_persisted", "success", { sequence: 400 }),
      event("slack_notification_completed", "success", { sequence: 500 }),
    ])

    expect(result.status).toBe("failed")
    expect(result.duplicateEvents).toEqual(["request_received"])
    expect(result.integrityViolations).toEqual(expect.arrayContaining([
      "event-sequence-invalid",
      "tier-sequence-invalid",
    ]))
  })

  it("requires a rendered success and an account-link check after Booking creation", () => {
    const result = evaluateChatbotAuditCompleteness([
      event("request_received"),
      event("tier_attempt_completed", "failure", {
        tier: "tier-1-hosted-chrome-notion-ai",
        phase: "generate",
        retryAttempt: 1,
      }),
      event("tier_attempt_completed", "success", {
        tier: "tier-2-gemini-flash",
        phase: "generate",
        retryAttempt: 2,
      }),
      event("response_normalized", "success", {
        tier: "tier-2-gemini-flash",
        uiKind: "booking-card",
        finalTierConsistent: true,
        tierSequenceValid: true,
      }),
      event("conversation_persisted"),
      event("slack_notification_completed"),
      event("booking_card_rendered"),
      event("booking_prefill_rendered"),
      event("booking_created"),
    ])

    expect(result.status).toBe("pending")
    expect(result.missingEvents).toEqual(expect.arrayContaining([
      "customer_account_linked",
      "booking_submit_success_rendered",
    ]))
  })

  it("fails when a successful Slack boundary lacks provider dedupe acknowledgement", () => {
    const result = evaluateChatbotAuditCompleteness([
      event("request_received"),
      event("tier_attempt_completed", "success", {
        tier: "tier-2-gemini-flash",
        phase: "generate",
        retryAttempt: 1,
      }),
      event("response_normalized", "success", {
        tier: "tier-2-gemini-flash",
        uiKind: "none",
        finalTierConsistent: true,
        tierSequenceValid: true,
      }),
      event("conversation_persisted"),
      event("slack_notification_completed", "success", {
        slackDeliveryEvidence: {
          deliveries: [{
            kind: "conversation",
            providerDedupeKeySubmitted: false,
            providerMessageTsPresent: true,
          }],
          uniqueIdempotencyKeys: false,
        },
      }),
    ])

    expect(result.status).toBe("failed")
    expect(result.integrityViolations).toContain("slack-delivery-not-exactly-once")
  })
})
