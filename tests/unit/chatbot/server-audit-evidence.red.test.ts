import { describe, expect, it } from "vitest"

import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import {
  buildChatbotBookingAuditEvents,
  buildChatbotMessageAuditEvents,
  buildChatbotMessageIntegrity,
  buildChatbotOperationFailureAuditEvent,
  summarizeTierAttemptForAudit,
} from "@/lib/chatbot/audit/server-evidence"

const correlationId = "11111111-1111-4111-8111-111111111111"
const slackSuccessEvidence = {
  result: "success" as const,
  deliveryEvidence: {
    deliveries: [{
      kind: "conversation" as const,
      deliveryRole: "parent" as const,
      idempotencyKeyHash: "a".repeat(64),
      providerDedupeKeySubmitted: true,
      providerMessageTsPresent: true,
      providerDeliveryAccepted: true,
    }],
    uniqueIdempotencyKeys: true,
  },
}

describe("chatbot server audit evidence", () => {
  it("accepts a fallback sequence when Tier 1 is rejected by its health check", () => {
    const events = buildChatbotMessageAuditEvents({
      requestId: correlationId,
      conversationId: "conversation_private_1",
      buildSha: "abc123",
      createdAt: "2026-08-23T00:00:00.000Z",
      finalTier: "tier-2-gemini-flash",
      uiKind: "choice-panel",
      stageTimings: {},
      tierAttempts: [
        {
          tier: "tier-1-hosted-chrome-notion-ai",
          phase: "health-check",
          result: "failure",
          durationMs: 250,
          errorCode: "rate-limit",
        },
        {
          tier: "tier-2-gemini-flash",
          phase: "health-check",
          result: "success",
          durationMs: 300,
        },
        {
          tier: "tier-2-gemini-flash",
          phase: "generate",
          result: "success",
          durationMs: 2_500,
        },
      ],
      slack: slackSuccessEvidence,
      messageIntegrity: buildChatbotMessageIntegrity(["user", "assistant"]),
    })

    expect(events.find((event) => event.eventName === "response_normalized")).toMatchObject({
      result: "success",
      finalTierConsistent: true,
      tierSequenceValid: true,
      tier: "tier-2-gemini-flash",
    })
  })

  it("preserves a same-tier deterministic repair as a failed attempt followed by repaired success", () => {
    const events = buildChatbotMessageAuditEvents({
      requestId: correlationId,
      conversationId: "conversation_private_1",
      buildSha: "abc123",
      createdAt: "2026-08-23T00:00:00.000Z",
      finalTier: "tier-2-gemini-flash",
      uiKind: "choice-panel",
      stageTimings: {},
      tierAttempts: [
        {
          tier: "tier-1-hosted-chrome-notion-ai",
          phase: "generate",
          result: "failure",
          durationMs: 20,
          errorCode: "rate-limit",
        },
        {
          tier: "tier-2-gemini-flash",
          phase: "generate",
          result: "failure",
          durationMs: 10,
          errorCode: "invalid-output",
          errorReason: "choice-set-choice-count-out-of-range",
          repairAttempted: true,
        },
        {
          tier: "tier-2-gemini-flash",
          phase: "generate",
          result: "success",
          durationMs: 0,
          repairAttempted: true,
        },
      ],
      slack: slackSuccessEvidence,
      messageIntegrity: buildChatbotMessageIntegrity(["user", "assistant"]),
    })

    expect(events.filter((event) => event.eventName === "tier_attempt_completed")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tier: "tier-2-gemini-flash",
          result: "failure",
          repairAttempted: true,
        }),
        expect.objectContaining({
          tier: "tier-2-gemini-flash",
          result: "success",
          repairAttempted: true,
        }),
      ]),
    )
    expect(events.find((event) => event.eventName === "response_normalized")).toMatchObject({
      result: "success",
      finalTierConsistent: true,
      tierSequenceValid: true,
    })
  })

  it("reduces a Tier attempt to an allowlisted, privacy-safe fact", () => {
    const evidence = summarizeTierAttemptForAudit({
      tier: "tier-1-hosted-chrome-notion-ai",
      phase: "generate",
      outcome: "error",
      latencyMs: 54_000,
      error: new ChatbotLlmError({
        message: "customer text and secret prompt",
        code: "timeout",
        tier: "tier-1-hosted-chrome-notion-ai",
        isRetryable: true,
      }),
      diagnostics: {
        endpoint: "/private/endpoint",
        workerStageDurations: {
          workerQueueWait: 12,
          cdpTargetSession: 20,
          runtimeContextPreparation: 40,
          promptToFirstChunk: 100,
          responseStreaming: 50,
          outputValidation: 5,
        },
        conversationThread: {
          threadId: "private-thread-id",
          hiddenFromChatList: true,
          hideVerificationResult: "verified",
          postHideInferenceVerified: true,
          threadVersion: 2,
        },
      },
    })

    expect(evidence).toEqual({
      tier: "tier-1-hosted-chrome-notion-ai",
      phase: "generate",
      result: "failure",
      durationMs: 54_000,
      errorCode: "timeout",
      stageTimings: {
        workerQueueWait: 12,
        cdpTargetSession: 20,
        runtimeContextPreparation: 40,
        promptToFirstChunk: 100,
        responseStreaming: 50,
        outputValidation: 5,
      },
      threadEvidence: {
        hiddenFromChatList: true,
        hideVerificationResult: "verified",
        postHideInferenceVerified: true,
        threadVersion: 2,
      },
    })
    expect(JSON.stringify(evidence)).not.toContain("customer text")
    expect(JSON.stringify(evidence)).not.toContain("private-thread-id")
    expect(JSON.stringify(evidence)).not.toContain("private/endpoint")
  })

  it("retains only the allowlisted invalid-output subtype needed for root-cause analysis", () => {
    const evidence = summarizeTierAttemptForAudit({
      tier: "tier-2-gemini-flash",
      phase: "generate",
      outcome: "error",
      latencyMs: 1_050,
      error: new ChatbotLlmError({
        message: "customer text must never be persisted",
        code: "invalid-output",
        tier: "tier-2-gemini-flash",
        isRetryable: false,
        cause: {
          boundary: "llm-output-contract",
          decision: "reject-and-regenerate-structured-ui",
          reason: "missing-structured-ui",
        },
      }),
    })

    expect(evidence).toEqual({
      tier: "tier-2-gemini-flash",
      phase: "generate",
      result: "failure",
      durationMs: 1_050,
      errorCode: "invalid-output",
      errorReason: "missing-structured-ui",
    })
    expect(JSON.stringify(evidence)).not.toContain("customer text")
  })

  it("builds deterministic, correlated boundary events for a successful customer response", () => {
    const input = {
      requestId: correlationId,
      conversationId: "conversation_private_1",
      buildSha: "abc123",
      createdAt: "2026-08-20T00:00:00.000Z",
      finalTier: "tier-2-gemini-flash" as const,
      uiKind: "booking-card" as const,
      stageTimings: {
        conversationLoad: 10,
        contextPreparation: 20,
        tierHealthCheck: 30,
        notionInference: 54_000,
        responseNormalization: 40,
        conversationPersist: 50,
        slackNotification: 60,
        totalServer: 54_210,
      },
      tierAttempts: [
        {
          tier: "tier-1-hosted-chrome-notion-ai" as const,
          phase: "generate" as const,
          result: "failure" as const,
          durationMs: 54_000,
          errorCode: "timeout",
        },
        {
          tier: "tier-2-gemini-flash" as const,
          phase: "generate" as const,
          result: "success" as const,
          durationMs: 180,
        },
      ],
      slack: slackSuccessEvidence,
      messageIntegrity: buildChatbotMessageIntegrity(["user", "assistant"]),
    }

    const first = buildChatbotMessageAuditEvents(input)
    const second = buildChatbotMessageAuditEvents(input)

    expect(second.map((event) => event.eventId)).toEqual(first.map((event) => event.eventId))
    expect(new Set(first.map((event) => event.eventId)).size).toBe(first.length)
    expect(first.map((event) => event.eventName)).toEqual([
      "request_received",
      "tier_attempt_completed",
      "tier_attempt_completed",
      "response_normalized",
      "conversation_persisted",
      "slack_notification_completed",
    ])
    expect(first.every((event) => event.correlationId === correlationId)).toBe(true)
    expect(first.find((event) => event.eventName === "response_normalized")).toMatchObject({
      tier: "tier-2-gemini-flash",
      fallbackUsed: true,
      tierAttemptCount: 2,
      finalTierConsistent: true,
      tierSequenceValid: true,
      uiKind: "booking-card",
      stageTimings: input.stageTimings,
    })
    expect(first.find((event) => event.eventName === "conversation_persisted")).toMatchObject({
      messageIntegrity: {
        userTurnCount: 1,
        assistantTurnCount: 1,
        messageCount: 2,
        sequenceValid: true,
      },
    })
    expect(JSON.stringify(first)).not.toContain("conversation_private_1")
  })

  it("fails the machine verdict for a missing Tier attempt or broken turn sequence", () => {
    const events = buildChatbotMessageAuditEvents({
      requestId: correlationId,
      conversationId: "conversation_private_1",
      buildSha: "abc123",
      createdAt: "2026-08-20T00:00:00.000Z",
      finalTier: "tier-1-hosted-chrome-notion-ai",
      uiKind: "none",
      stageTimings: {},
      tierAttempts: [],
      slack: slackSuccessEvidence,
      messageIntegrity: buildChatbotMessageIntegrity(["user", "user", "assistant"]),
    })

    expect(events.find((event) => event.eventName === "response_normalized")).toMatchObject({
      result: "failure",
      finalTierConsistent: false,
      tierSequenceValid: false,
      errorCode: "tier-evidence-inconsistent",
    })
    expect(events.find((event) => event.eventName === "conversation_persisted")).toMatchObject({
      result: "failure",
      errorCode: "message-sequence-invalid",
    })
  })

  it("fails when fallback tiers are attempted out of order or after success", () => {
    const events = buildChatbotMessageAuditEvents({
      requestId: correlationId,
      conversationId: "conversation_private_1",
      buildSha: "abc123",
      createdAt: "2026-08-20T00:00:00.000Z",
      finalTier: "tier-1-hosted-chrome-notion-ai",
      uiKind: "none",
      stageTimings: {},
      tierAttempts: [
        {
          tier: "tier-1-hosted-chrome-notion-ai",
          phase: "generate",
          result: "success",
          durationMs: 20,
        },
        {
          tier: "tier-2-gemini-flash",
          phase: "generate",
          result: "failure",
          durationMs: 20,
          errorCode: "unexpected-fallback",
        },
      ],
      slack: slackSuccessEvidence,
      messageIntegrity: buildChatbotMessageIntegrity(["user", "assistant"]),
    })

    expect(events.find((event) => event.eventName === "response_normalized")).toMatchObject({
      result: "failure",
      tierSequenceValid: false,
      errorCode: "tier-sequence-invalid",
    })
  })

  it("records booking creation, authenticated customer linkage, and Slack as separate facts", () => {
    const events = buildChatbotBookingAuditEvents({
      requestId: correlationId,
      conversationId: "conversation_private_1",
      buildSha: "abc123",
      createdAt: "2026-08-20T00:00:00.000Z",
      bookingCreated: true,
      customerAuthenticated: true,
      customerAccountLinked: true,
      slack: slackSuccessEvidence,
      durationMs: 420,
    })

    expect(events.map((event) => event.eventName)).toEqual([
      "booking_created",
      "customer_account_linked",
      "slack_notification_completed",
    ])
    expect(events.every((event) => event.correlationId === correlationId)).toBe(true)
    expect(events.every((event) => event.conversationHash === events[0].conversationHash)).toBe(true)
    expect(events.find((event) => event.eventName === "customer_account_linked")).toMatchObject({
      result: "success",
      customerAccountEvidence: {
        authenticated: true,
        expectedLinked: true,
        actualLinked: true,
        matches: true,
      },
    })
    expect(JSON.stringify(events)).not.toContain("conversation_private_1")
  })

  it("records the account-link check as successful and not applicable for a guest", () => {
    const events = buildChatbotBookingAuditEvents({
      requestId: correlationId,
      conversationId: "conversation_private_1",
      buildSha: "abc123",
      createdAt: "2026-08-20T00:00:00.000Z",
      bookingCreated: true,
      customerAuthenticated: false,
      customerAccountLinked: false,
      slack: slackSuccessEvidence,
      durationMs: 420,
    })

    expect(events.find((event) => event.eventName === "customer_account_linked")).toMatchObject({
      result: "success",
      customerAccountEvidence: {
        authenticated: false,
        expectedLinked: false,
        actualLinked: false,
        matches: true,
      },
    })
  })

  it("records operation failures by safe code without retaining the error message", () => {
    const event = buildChatbotOperationFailureAuditEvent({
      requestId: correlationId,
      conversationId: "conversation_private_1",
      buildSha: "abc123",
      createdAt: "2026-08-20T00:00:00.000Z",
      errorCode: "booking-save-failed",
      durationMs: 250,
    })

    expect(event).toMatchObject({
      eventName: "operation_failed",
      result: "failure",
      errorCode: "booking-save-failed",
      durationMs: 250,
      correlationId,
    })
    expect(JSON.stringify(event)).not.toContain("conversation_private_1")
  })
})
