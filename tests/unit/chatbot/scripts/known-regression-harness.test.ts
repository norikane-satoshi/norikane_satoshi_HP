import { describe, expect, it } from "vitest"

import {
  evaluateKnownRegressionRun,
  type KnownRegressionAuditEvent,
  type KnownRegressionInput,
} from "../../../../scripts/chatbot/verify-known-regressions-live"

const buildSha = "abc123"
const firstRequestId = "11111111-1111-4111-8111-111111111111"
const editRequestId = "22222222-2222-4222-8222-222222222222"

function successfulEvents(
  correlationId: string,
  tier: "tier-1-hosted-chrome-notion-ai" | "tier-2-gemini-flash",
): KnownRegressionAuditEvent[] {
  return [
    { correlationId, eventName: "request_received", result: "success", buildSha, sequence: 100 },
    ...(tier === "tier-2-gemini-flash"
      ? [{
          correlationId,
          eventName: "tier_attempt_completed",
          result: "failure",
          tier: "tier-1-hosted-chrome-notion-ai",
          errorCode: "rate-limit",
          buildSha,
          sequence: 201,
        }]
      : []),
    {
      correlationId,
      eventName: "tier_attempt_completed",
      result: "success",
      tier,
      buildSha,
      sequence: tier === "tier-2-gemini-flash" ? 202 : 201,
    },
    {
      correlationId,
      eventName: "response_normalized",
      result: "success",
      tier,
      buildSha,
      sequence: 300,
      finalTierConsistent: true,
      tierSequenceValid: true,
    },
    { correlationId, eventName: "conversation_persisted", result: "success", buildSha, sequence: 400 },
    { correlationId, eventName: "slack_notification_completed", result: "success", buildSha, sequence: 500 },
  ]
}

function successfulRun(): KnownRegressionInput {
  return {
    expectedBuildSha: buildSha,
    first: {
      requestId: firstRequestId,
      httpStatus: 200,
      tier: "tier-2-gemini-flash" as const,
    },
    edit: {
      requestId: editRequestId,
      httpStatus: 200,
      tier: "tier-2-gemini-flash" as const,
    },
    conversationStable: true,
    editTargetMatched: true,
    conversationShape: {
      messageCount: 2,
      userTurnCount: 1,
      assistantTurnCount: 1,
      sequenceValid: true,
    },
    auditObservationComplete: true,
    auditEvents: [
      ...successfulEvents(firstRequestId, "tier-2-gemini-flash"),
      ...successfulEvents(editRequestId, "tier-2-gemini-flash"),
    ],
  }
}

describe("known chatbot regression harness", () => {
  it("accepts an expected Tier 1 rate-limit fallback when Tier 2 and every boundary succeed", () => {
    expect(evaluateKnownRegressionRun(successfulRun())).toMatchObject({
      ok: true,
      violations: [],
      checks: {
        editResendSucceeded: true,
        tierOutcomeAccepted: true,
        auditBoundariesComplete: true,
        conversationRoundTripValid: true,
      },
    })
  })

  it("ignores historical failures outside the exact canary correlations", () => {
    const input = successfulRun()
    input.auditEvents.push({
      correlationId: "33333333-3333-4333-8333-333333333333",
      eventName: "operation_failed",
      result: "failure",
      errorCode: "message-conversation-save-failed",
      buildSha: "stale-build",
      sequence: 900,
    })

    const report = evaluateKnownRegressionRun(input)

    expect(report.ok).toBe(true)
    expect(report.violations).toEqual([])
    expect(report.auditEventCount).toBe(12)
  })

  it("reports delayed audit persistence as inconclusive instead of a product regression", () => {
    const input = successfulRun()
    input.auditObservationComplete = false
    input.auditEvents = input.auditEvents.filter((event) => event.correlationId === firstRequestId)

    expect(evaluateKnownRegressionRun(input)).toMatchObject({
      ok: false,
      verdict: "inconclusive",
      violations: [],
      inconclusiveReasons: ["audit-observation-timeout"],
    })
  })

  it("fails with stable machine codes for edit DB failure, Tier 3, audit gaps, and duplicate turns", () => {
    const input = successfulRun()
    input.edit.httpStatus = 500
    input.edit.tier = "tier-3-form-fallback"
    input.auditEvents = input.auditEvents.filter(
      (event) => !(event.correlationId === editRequestId && event.eventName === "conversation_persisted"),
    )
    input.auditEvents.push({
      correlationId: editRequestId,
      eventName: "operation_failed",
      result: "failure",
      errorCode: "message-conversation-save-failed",
      buildSha,
      sequence: 900,
    })
    input.conversationShape = {
      messageCount: 4,
      userTurnCount: 2,
      assistantTurnCount: 2,
      sequenceValid: true,
    }

    expect(evaluateKnownRegressionRun(input)).toMatchObject({
      ok: false,
      violations: expect.arrayContaining([
        "edit-resend-http-failed",
        "unexpected-tier3",
        "operation-failed-detected",
        "audit-boundary-missing",
        "conversation-roundtrip-invalid",
      ]),
    })
  })

  it("returns only privacy-safe evidence and never includes message or conversation content", () => {
    const serialized = JSON.stringify(evaluateKnownRegressionRun(successfulRun()))

    expect(serialized).not.toContain("再テスト")
    expect(serialized).not.toContain("conversationId")
    expect(serialized).not.toContain("messageId")
    expect(serialized).not.toContain("errorMessage")
  })
})
