import { describe, expect, it } from "vitest"

import {
  evaluateEnduranceRun,
  type EnduranceAuditEvent,
  type EnduranceInput,
} from "../../../../scripts/chatbot/verify-endurance-live"

const buildSha = "abc123"
const requestIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
]

function successfulEvents(correlationId: string): EnduranceAuditEvent[] {
  return [
    { correlationId, eventName: "request_received", result: "success", buildSha, sequence: 100 },
    {
      correlationId,
      eventName: "tier_attempt_completed",
      result: "failure",
      tier: "tier-1-hosted-chrome-notion-ai",
      errorCode: "rate-limit",
      buildSha,
      sequence: 201,
    },
    {
      correlationId,
      eventName: "tier_attempt_completed",
      result: "success",
      tier: "tier-2-gemini-flash",
      buildSha,
      sequence: 202,
    },
    {
      correlationId,
      eventName: "response_normalized",
      result: "success",
      tier: "tier-2-gemini-flash",
      buildSha,
      sequence: 300,
      finalTierConsistent: true,
      tierSequenceValid: true,
    },
    { correlationId, eventName: "conversation_persisted", result: "success", buildSha, sequence: 400 },
    { correlationId, eventName: "slack_notification_completed", result: "success", buildSha, sequence: 500 },
  ]
}

function passingInput(): EnduranceInput {
  return {
    expectedBuildSha: buildSha,
    turns: requestIds.map((requestId) => ({
      requestId,
      httpStatus: 200,
      tier: "tier-2-gemini-flash" as const,
    })),
    conversationStable: true,
    conversationShape: {
      messageCount: 6,
      userTurnCount: 3,
      assistantTurnCount: 3,
      sequenceValid: true,
    },
    auditObservationComplete: true,
    auditEvents: requestIds.flatMap(successfulEvents),
  }
}

describe("chatbot endurance harness", () => {
  it("accepts every turn when Tier 1 rate limits but Tier 2 completes all exact boundaries", () => {
    expect(evaluateEnduranceRun(passingInput())).toMatchObject({
      ok: true,
      verdict: "passed",
      turnCount: 3,
      violations: [],
      inconclusiveReasons: [],
      checks: {
        everyHttpRequestSucceeded: true,
        everyTierOutcomeAccepted: true,
        auditBoundariesComplete: true,
        conversationRoundTripValid: true,
      },
    })
  })

  it("ignores historical failures outside this run's exact request correlations", () => {
    const input = passingInput()
    input.auditEvents.push({
      correlationId: "44444444-4444-4444-8444-444444444444",
      eventName: "operation_failed",
      result: "failure",
      buildSha: "old-build",
      errorCode: "message-server-handler-failed",
      sequence: 900,
    })

    expect(evaluateEnduranceRun(input)).toMatchObject({ ok: true, auditEventCount: 18 })
  })

  it("marks audit propagation delay as inconclusive rather than a product regression", () => {
    const input = passingInput()
    input.auditObservationComplete = false
    input.auditEvents = input.auditEvents.filter((event) => event.correlationId !== requestIds[2])

    expect(evaluateEnduranceRun(input)).toMatchObject({
      ok: false,
      verdict: "inconclusive",
      violations: [],
      inconclusiveReasons: ["audit-observation-timeout"],
    })
  })

  it("still fails an observed HTTP interruption when audit persistence is delayed", () => {
    const input = passingInput()
    input.turns[2].httpStatus = 500
    input.turns[2].tier = "tier-3-form-fallback"
    input.auditObservationComplete = false
    input.auditEvents = input.auditEvents.filter((event) => event.correlationId !== requestIds[2])

    expect(evaluateEnduranceRun(input)).toMatchObject({
      ok: false,
      verdict: "failed",
      violations: expect.arrayContaining(["turn-http-failed", "unexpected-tier3"]),
      inconclusiveReasons: ["audit-observation-timeout"],
    })
  })

  it("fails duplicate or truncated conversation history using exact N-turn shape", () => {
    const input = passingInput()
    input.conversationShape = {
      messageCount: 5,
      userTurnCount: 3,
      assistantTurnCount: 2,
      sequenceValid: false,
    }

    expect(evaluateEnduranceRun(input)).toMatchObject({
      ok: false,
      verdict: "failed",
      violations: ["conversation-roundtrip-invalid"],
    })
  })

  it("returns privacy-safe evidence without conversation or message content", () => {
    const serialized = JSON.stringify(evaluateEnduranceRun(passingInput()))

    expect(serialized).not.toContain("conversationId")
    expect(serialized).not.toContain("messageId")
    expect(serialized).not.toContain("messageContent")
  })
})
