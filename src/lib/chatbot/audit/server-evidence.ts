import { createHash } from "node:crypto"

import {
  chatbotAuditStageTimingsSchema,
  chatbotAuditUiKindSchema,
  chatbotServerAuditEventSchema,
  type ChatbotStoredAuditEvent,
  type ChatbotAuditStageTimings,
  type ChatbotMessageIntegrity,
  type ChatbotSlackDeliveryEvidence,
} from "@/lib/chatbot/audit/contract"
import { toStoredChatbotServerAuditEvent } from "@/lib/chatbot/audit/server-projection"
import {
  ChatbotLlmError,
  getChatbotLlmOutputContractRejection,
  type ChatbotLlmResponse,
} from "@/lib/chatbot/server/llm-client"
import type { TierAttemptEvent } from "@/lib/chatbot/server/llm-orchestrator"

export type ChatbotTierAttemptAuditEvidence = {
  tier: TierAttemptEvent["tier"]
  phase: TierAttemptEvent["phase"]
  result: "success" | "failure"
  durationMs: number
  errorCode?: string
  errorReason?: string
  repairAttempted?: boolean
  stageTimings?: ChatbotAuditStageTimings
  threadEvidence?: {
    hiddenFromChatList: boolean
    hideVerificationResult: string
    postHideInferenceVerified: boolean
    threadVersion?: number
  }
}

export type ChatbotMessageAuditEvidence = {
  stageTimings: Partial<{
    conversationLoad: number
    contextPreparation: number
    tierHealthCheck: number
    workerQueueWait: number
    threadPreparation: number
    threadHideVerification: number
    notionInference: number
    responseNormalization: number
    conversationPersist: number
    slackNotification: number
    totalServer: number
  }>
  tierAttempts: ChatbotTierAttemptAuditEvidence[]
  slack: {
    result: "success" | "failure"
    errorCode?: string
    deliveryEvidence?: ChatbotSlackDeliveryEvidence
  }
  messageIntegrity: ChatbotMessageIntegrity
}

export function buildChatbotMessageIntegrity(
  roles: Array<"user" | "assistant" | "system">,
): ChatbotMessageIntegrity {
  const conversationalRoles = roles.filter(
    (role): role is "user" | "assistant" => role === "user" || role === "assistant",
  )
  const userTurnCount = conversationalRoles.filter((role) => role === "user").length
  const assistantTurnCount = conversationalRoles.filter((role) => role === "assistant").length
  const sequenceValid = conversationalRoles.every(
    (role, index) => role === (index % 2 === 0 ? "user" : "assistant"),
  ) && userTurnCount === assistantTurnCount

  return {
    userTurnCount,
    assistantTurnCount,
    messageCount: conversationalRoles.length,
    sequenceValid,
  }
}

export function summarizeTierAttemptForAudit(event: TierAttemptEvent): ChatbotTierAttemptAuditEvidence {
  const threadEvidence = extractThreadEvidence(event.diagnostics)
  const stageTimings = extractWorkerStageTimings(event.diagnostics)
  const success = event.outcome === "healthy" || event.outcome === "success"
  const errorReason = success ? undefined : safeErrorReason(event.error)
  return {
    tier: event.tier,
    phase: event.phase,
    result: success ? "success" : "failure",
    durationMs: toDuration(event.latencyMs),
    ...(!success ? { errorCode: safeErrorCode(event.error) } : {}),
    ...(errorReason ? { errorReason } : {}),
    ...(stageTimings ? { stageTimings } : {}),
    ...(threadEvidence ? { threadEvidence } : {}),
  }
}

export function buildChatbotMessageAuditEvents(input: {
  requestId: string
  conversationId: string
  buildSha: string
  createdAt: string
  finalTier: TierAttemptEvent["tier"]
  uiKind: string
  stageTimings: ChatbotMessageAuditEvidence["stageTimings"]
  tierAttempts: ChatbotTierAttemptAuditEvidence[]
  slack: ChatbotMessageAuditEvidence["slack"]
  messageIntegrity: ChatbotMessageAuditEvidence["messageIntegrity"]
}): ChatbotStoredAuditEvent[] {
  const uiKind = chatbotAuditUiKindSchema.parse(input.uiKind)
  const stageTimings = chatbotAuditStageTimingsSchema.parse(input.stageTimings)
  const fallbackUsed = input.finalTier !== "tier-1-hosted-chrome-notion-ai"
  const generateAttempts = input.tierAttempts.filter((attempt) => attempt.phase === "generate")
  const successfulGenerateAttempts = generateAttempts.filter((attempt) => attempt.result === "success")
  const finalTierConsistent = successfulGenerateAttempts.length === 1 &&
    successfulGenerateAttempts[0].tier === input.finalTier &&
    (input.finalTier !== "tier-1-hosted-chrome-notion-ai" || !fallbackUsed)
  const tierSequenceValid = validateTierSequence(input.tierAttempts, input.finalTier)
  const drafts: Array<Record<string, unknown>> = [
    {
      eventName: "request_received",
      result: "success",
      durationMs: stageTimings.conversationLoad,
    },
  ]

  input.tierAttempts.forEach((attempt, index) => {
    drafts.push({
      eventName: "tier_attempt_completed",
      result: attempt.result,
      tier: attempt.tier,
      phase: attempt.phase,
      durationMs: attempt.durationMs,
      ...(attempt.errorCode ? { errorCode: attempt.errorCode } : {}),
      ...(attempt.errorReason ? { errorReason: attempt.errorReason } : {}),
      ...(attempt.repairAttempted !== undefined
        ? { repairAttempted: attempt.repairAttempted }
        : {}),
      fallbackUsed,
      retryAttempt: index + 1,
      ...(attempt.stageTimings ? { stageTimings: attempt.stageTimings } : {}),
        ...(attempt.threadEvidence ? { threadEvidence: attempt.threadEvidence } : {}),
    })
    if (attempt.threadEvidence) {
      drafts.push({
        eventName: "notion_thread_hidden_verified",
        result:
          attempt.threadEvidence.hiddenFromChatList &&
          attempt.threadEvidence.hideVerificationResult === "verified" &&
          attempt.threadEvidence.postHideInferenceVerified
            ? "success"
            : "failure",
        tier: attempt.tier,
        retryAttempt: index + 1,
        threadEvidence: attempt.threadEvidence,
      })
    }
  })

  drafts.push(
    {
      eventName: "response_normalized",
      result: finalTierConsistent && tierSequenceValid ? "success" : "failure",
      tier: input.finalTier,
      uiKind,
      fallbackUsed,
      tierAttemptCount: input.tierAttempts.length,
      finalTierConsistent,
      tierSequenceValid,
      ...(!finalTierConsistent
        ? { errorCode: "tier-evidence-inconsistent" }
        : !tierSequenceValid
          ? { errorCode: "tier-sequence-invalid" }
          : {}),
      durationMs: stageTimings.responseNormalization,
      stageTimings,
    },
    {
      eventName: "conversation_persisted",
      result: input.messageIntegrity.sequenceValid ? "success" : "failure",
      tier: input.finalTier,
      durationMs: stageTimings.conversationPersist,
      messageIntegrity: input.messageIntegrity,
      ...(!input.messageIntegrity.sequenceValid ? { errorCode: "message-sequence-invalid" } : {}),
    },
    {
      eventName: "slack_notification_completed",
      result: input.slack.result,
      tier: input.finalTier,
      durationMs: stageTimings.slackNotification,
      ...(input.slack.errorCode ? { errorCode: input.slack.errorCode } : {}),
      ...(input.slack.deliveryEvidence
        ? { slackDeliveryEvidence: input.slack.deliveryEvidence }
        : {}),
    },
  )

  return drafts.map((draft, index) => {
    const event = chatbotServerAuditEventSchema.parse({
      schemaVersion: "1",
      eventId: deterministicAuditEventId(input.requestId, String(draft.eventName), index),
      correlationId: input.requestId,
      conversationId: input.conversationId,
      ...draft,
    })
    return toStoredChatbotServerAuditEvent(event, {
      source: "server",
      buildSha: input.buildSha,
      createdAt: input.createdAt,
    })
  })
}

function extractWorkerStageTimings(
  diagnostics: ChatbotLlmResponse["diagnostics"] | undefined,
): ChatbotAuditStageTimings | undefined {
  const root = asRecord(diagnostics)
  const parsed = chatbotAuditStageTimingsSchema.safeParse(root?.workerStageDurations)
  return parsed.success && Object.keys(parsed.data).length > 0 ? parsed.data : undefined
}

export function buildChatbotBookingAuditEvents(input: {
  requestId: string
  conversationId: string
  buildSha: string
  createdAt: string
  bookingCreated: boolean
  customerAuthenticated: boolean
  customerAccountLinked: boolean
  slack: ChatbotMessageAuditEvidence["slack"]
  durationMs: number
}): ChatbotStoredAuditEvent[] {
  const drafts: Array<Record<string, unknown>> = [
    {
      eventName: "booking_created",
      result: input.bookingCreated ? "success" : "failure",
      durationMs: toDuration(input.durationMs),
      ...(!input.bookingCreated ? { errorCode: "booking-create-failed" } : {}),
    },
    {
      eventName: "customer_account_linked",
      result: input.customerAuthenticated === input.customerAccountLinked ? "success" : "failure",
      customerAccountEvidence: {
        authenticated: input.customerAuthenticated,
        expectedLinked: input.customerAuthenticated,
        actualLinked: input.customerAccountLinked,
        matches: input.customerAuthenticated === input.customerAccountLinked,
      },
      ...(input.customerAuthenticated !== input.customerAccountLinked
        ? { errorCode: "customer-account-link-mismatch" }
        : {}),
    },
    {
      eventName: "slack_notification_completed",
      result: input.slack.result,
      ...(input.slack.errorCode ? { errorCode: input.slack.errorCode } : {}),
      ...(input.slack.deliveryEvidence
        ? { slackDeliveryEvidence: input.slack.deliveryEvidence }
        : {}),
    },
  ]

  return drafts.map((draft, index) => {
    const event = chatbotServerAuditEventSchema.parse({
      schemaVersion: "1",
      eventId: deterministicAuditEventId(input.requestId, `booking:${String(draft.eventName)}`, index),
      correlationId: input.requestId,
      conversationId: input.conversationId,
      ...draft,
    })
    return toStoredChatbotServerAuditEvent(event, {
      source: "server",
      buildSha: input.buildSha,
      createdAt: input.createdAt,
    })
  })
}

const tierRanks = {
  "tier-1-hosted-chrome-notion-ai": 1,
  "tier-2-gemini-flash": 2,
  "tier-3-form-fallback": 3,
} as const

function validateTierSequence(
  attempts: ChatbotTierAttemptAuditEvidence[],
  finalTier: ChatbotTierAttemptAuditEvidence["tier"],
): boolean {
  if (attempts.length === 0) return false
  const finalRank = tierRanks[finalTier]
  const ranks = attempts.map((attempt) => tierRanks[attempt.tier])
  const nondecreasing = ranks.every((rank, index) => index === 0 || rank >= ranks[index - 1])
  const successfulGenerates = attempts.filter(
    (attempt) => attempt.phase === "generate" && attempt.result === "success",
  )
  const finalAttempt = attempts.at(-1)
  const oneFinalSuccess = successfulGenerates.length === 1 &&
    successfulGenerates[0]?.tier === finalTier &&
    finalAttempt?.phase === "generate" &&
    finalAttempt.result === "success" &&
    finalAttempt.tier === finalTier
  const everyTierReached = Array.from({ length: finalRank }, (_, index) => index + 1)
    .every((rank) => ranks.includes(rank as 1 | 2 | 3))
  return nondecreasing && oneFinalSuccess && everyTierReached
}

export function buildChatbotOperationFailureAuditEvent(input: {
  requestId: string
  conversationId: string
  buildSha: string
  createdAt: string
  errorCode: string
  durationMs: number
}): ChatbotStoredAuditEvent {
  const event = chatbotServerAuditEventSchema.parse({
    schemaVersion: "1",
    eventId: deterministicAuditEventId(input.requestId, "operation:operation_failed", 0),
    correlationId: input.requestId,
    conversationId: input.conversationId,
    eventName: "operation_failed",
    result: "failure",
    errorCode: safeCode(input.errorCode),
    durationMs: toDuration(input.durationMs),
  })
  return toStoredChatbotServerAuditEvent(event, {
    source: "server",
    buildSha: input.buildSha,
    createdAt: input.createdAt,
  })
}

function extractThreadEvidence(
  diagnostics: ChatbotLlmResponse["diagnostics"] | undefined,
): ChatbotTierAttemptAuditEvidence["threadEvidence"] | undefined {
  const root = asRecord(diagnostics)
  const thread = asRecord(root?.conversationThread)
  if (!thread) return undefined
  if (typeof thread.hiddenFromChatList !== "boolean") return undefined
  if (typeof thread.hideVerificationResult !== "string") return undefined
  if (typeof thread.postHideInferenceVerified !== "boolean") return undefined

  return {
    hiddenFromChatList: thread.hiddenFromChatList,
    hideVerificationResult: safeCode(thread.hideVerificationResult),
    postHideInferenceVerified: thread.postHideInferenceVerified,
    ...(typeof thread.threadVersion === "number" && Number.isInteger(thread.threadVersion) && thread.threadVersion > 0
      ? { threadVersion: thread.threadVersion }
      : {}),
  }
}

function safeErrorCode(error: TierAttemptEvent["error"]): string {
  return error instanceof ChatbotLlmError ? error.code : "unknown"
}

function safeErrorReason(error: TierAttemptEvent["error"]): string | undefined {
  const contractRejection = getChatbotLlmOutputContractRejection(error)
  if (contractRejection) return contractRejection.reason
  if (!(error instanceof ChatbotLlmError)) return undefined
  const cause = asRecord(error.cause)
  return cause?.invalidOutputReason === "empty-response" ? "empty-response" : undefined
}

function safeCode(value: string): string {
  return /^[a-z0-9][a-z0-9_.:-]{0,119}$/i.test(value) ? value : "unknown"
}

function toDuration(value: number): number {
  return Math.max(0, Math.min(180_000, Math.round(value)))
}

function deterministicAuditEventId(correlationId: string, eventName: string, index: number): string {
  const bytes = createHash("sha256")
    .update("norikane-hp-chatbot-audit-event-v1")
    .update("\0")
    .update(correlationId)
    .update("\0")
    .update(eventName)
    .update("\0")
    .update(String(index))
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
