import type {
  ChatbotMessageRole,
  ConversationState,
  JobContext,
  SurveyChoiceSet,
} from "@/lib/chatbot/domain"
import { logChatbotBoundaryEvent } from "@/lib/chatbot/server/boundary-event-log"
import {
  createChatbotLlmDisplayEnvelope,
  normalizeChatbotLlmChoiceSetAtDisplayBoundary,
} from "@/lib/chatbot/server/llm-response-normalizer"

export const chatbotLlmTierIds = {
  tier1HostedChromeNotionAi: "tier-1-hosted-chrome-notion-ai",
  tier2GeminiFlash: "tier-2-gemini-flash",
  tier3FormFallback: "tier-3-form-fallback",
} as const

export type ChatbotLlmTier = (typeof chatbotLlmTierIds)[keyof typeof chatbotLlmTierIds]

const chatbotLlmTiers = Object.values(chatbotLlmTierIds)

export type ChatbotLlmOutputContractRejectionReason =
  | "missing-structured-ui"
  | "choice-set-id-not-allowlisted"
  | "choice-set-question-missing"
  | "choice-set-question-too-long"
  | "choice-set-choice-count-out-of-range"
  | "choice-set-choice-invalid"

export type ChatbotLlmOutputContractRejection = {
  boundary: "llm-output-contract"
  decision: "reject-and-fallback-tier" | "reject-and-regenerate-structured-ui"
  reason: ChatbotLlmOutputContractRejectionReason
}

export type ChatbotLlmRequest = {
  requestId?: string
  /** Opaque server-side id used only to keep hosted Notion AI threads isolated per consultation. */
  conversationId?: string
  systemPrompt: string
  messages: ReadonlyArray<{ role: ChatbotMessageRole; content: string }>
  conversationState: ConversationState
  jobContext: JobContext
  latestUserMessage?: string
  temperature?: number
  maxOutputTokens?: number
}

export type ChatbotLlmGenerateOptions = {
  signal?: AbortSignal
}

export type ChatbotLlmDisplayEnvelope = {
  text: string
  displayText: string
  uiPayload:
    | { kind: "none" }
    | { kind: "choice-panel"; choiceSet: SurveyChoiceSet }
    | { kind: "booking-card"; args?: Record<string, unknown> }
    | { kind: "invalid"; reason: ChatbotLlmOutputContractRejectionReason }
  source: "customer-reply-tag" | "json-customer-reply" | "trusted-server-display"
  defaultDenied: boolean
  fallbackApplied: boolean
  reasons: Array<
      | "missing-explicit-display-boundary"
      | "empty-display-text"
      | "unsafe-display-candidate"
      | "unsafe-fallback-text"
      | "trusted-server-display"
  >
}

export type ChatbotLlmResponse = {
  rawText: string
  displayEnvelope: ChatbotLlmDisplayEnvelope
  tokensUsed?: number
  latencyMs?: number
  tier: ChatbotLlmTier
  diagnostics?: Record<string, unknown>
}

export function createChatbotLlmResponse(
  input: Omit<ChatbotLlmResponse, "displayEnvelope">,
): ChatbotLlmResponse {
  return {
    ...input,
    displayEnvelope: createChatbotLlmDisplayEnvelope(input.rawText),
  }
}

export interface ChatbotLlmClient {
  readonly tier: ChatbotLlmTier
  generate(request: ChatbotLlmRequest, options?: ChatbotLlmGenerateOptions): Promise<ChatbotLlmResponse>
  isHealthy(): Promise<boolean>
  getLastHealthError?(): ChatbotLlmError | Error | undefined
}

type ChatbotLlmErrorCode =
  | "timeout"
  | "rate-limit"
  | "invalid-output"
  | "connection"
  | "auth"
  | "unknown"

export class ChatbotLlmError extends Error {
  readonly code: ChatbotLlmErrorCode
  readonly tier: ChatbotLlmTier
  readonly isRetryable: boolean
  override readonly cause?: unknown

  constructor(input: {
    message: string
    code: ChatbotLlmErrorCode
    tier: ChatbotLlmTier
    isRetryable: boolean
    cause?: unknown
  }) {
    super(input.message)
    this.name = "ChatbotLlmError"
    this.code = input.code
    this.tier = input.tier
    this.isRetryable = input.isRetryable
    this.cause = input.cause
  }
}

export function assertChatbotLlmResponseContract(
  response: unknown,
  expectedTier?: ChatbotLlmTier,
): asserts response is ChatbotLlmResponse {
  const record = asRecord(response)
  if (!record) throw invalidContractError(expectedTier, "response must be an object")

  if (typeof record.rawText !== "string") throw invalidContractError(expectedTier, "rawText must be a string")
  if (expectedTier && record.tier !== expectedTier) throw invalidContractError(expectedTier, "tier mismatch")
  if (!isChatbotLlmTier(record.tier)) throw invalidContractError(expectedTier, "tier must be a known tier")

  const envelope = asRecord(record.displayEnvelope)
  if (!envelope) throw invalidContractError(expectedTier, "displayEnvelope must be an object")
  if (typeof envelope.text !== "string") throw invalidContractError(expectedTier, "displayEnvelope.text must be a string")
  if (typeof envelope.displayText !== "string") {
    throw invalidContractError(expectedTier, "displayEnvelope.displayText must be a string")
  }
  if (!isDisplayEnvelopeSource(envelope.source)) {
    throw invalidContractError(expectedTier, "displayEnvelope.source must be known")
  }
  if (typeof envelope.defaultDenied !== "boolean") {
    throw invalidContractError(expectedTier, "displayEnvelope.defaultDenied must be boolean")
  }
  if (typeof envelope.fallbackApplied !== "boolean") {
    throw invalidContractError(expectedTier, "displayEnvelope.fallbackApplied must be boolean")
  }
  if (!Array.isArray(envelope.reasons) || !envelope.reasons.every(isDisplayEnvelopeReason)) {
    throw invalidContractError(expectedTier, "displayEnvelope.reasons must be known reason strings")
  }

  const uiPayload = validateDisplayEnvelopeUiPayload(envelope.uiPayload, expectedTier)
  if (uiPayload.kind === "invalid") {
    throw outputContractError(record.tier, {
      boundary: "llm-output-contract",
      decision: "reject-and-regenerate-structured-ui",
      reason: uiPayload.reason,
    })
  }
  if (tierOutputPolicies[record.tier].structuredUi === "required" && uiPayload.kind === "none") {
    throw outputContractError(record.tier, {
      boundary: "llm-output-contract",
      decision: "reject-and-fallback-tier",
      reason: "missing-structured-ui",
    })
  }
}

export function isChatbotLlmResponseContractError(error: unknown): error is ChatbotLlmError {
  return error instanceof ChatbotLlmError && error.code === "invalid-output"
}

/**
 * Tier 3 is the final deterministic form fallback chosen after all AI assistant
 * tiers fail.
 */
export const defaultLlmTierOrder: ReadonlyArray<ChatbotLlmTier> = [
  chatbotLlmTierIds.tier1HostedChromeNotionAi,
  chatbotLlmTierIds.tier2GeminiFlash,
  chatbotLlmTierIds.tier3FormFallback,
] as const

const tierOutputPolicies: Record<ChatbotLlmTier, { structuredUi: "optional" | "required" }> = {
  [chatbotLlmTierIds.tier1HostedChromeNotionAi]: { structuredUi: "optional" },
  [chatbotLlmTierIds.tier2GeminiFlash]: { structuredUi: "required" },
  [chatbotLlmTierIds.tier3FormFallback]: { structuredUi: "optional" },
}

export function getChatbotLlmOutputContractRejection(
  error: unknown,
): ChatbotLlmOutputContractRejection | undefined {
  if (!(error instanceof ChatbotLlmError) || error.code !== "invalid-output") return undefined
  const cause = asRecord(error.cause)
  if (
    cause?.boundary !== "llm-output-contract" ||
    (cause.decision !== "reject-and-fallback-tier" &&
      cause.decision !== "reject-and-regenerate-structured-ui") ||
    !isOutputContractRejectionReason(cause.reason)
  ) {
    return undefined
  }

  return {
    boundary: cause.boundary,
    decision: cause.decision,
    reason: cause.reason,
  }
}

export function logChatbotLlmOutputContractRejection(input: {
  requestId?: string
  tier: ChatbotLlmTier
  rejection: ChatbotLlmOutputContractRejection
}): void {
  logChatbotBoundaryEvent({
    event: "chatbot_llm_output_contract_boundary",
    requestId: input.requestId,
    tier: input.tier,
    boundary: input.rejection.boundary,
    decision: input.rejection.decision,
    reason: input.rejection.reason,
  })
}

export function normalizeChatbotLlmChoiceSet(value: Record<string, unknown>): SurveyChoiceSet | undefined {
  return normalizeChatbotLlmChoiceSetAtDisplayBoundary(value)
}

function invalidContractError(tier: ChatbotLlmTier | undefined, reason: string): ChatbotLlmError {
  return new ChatbotLlmError({
    message: `Chatbot LLM response violated the shared contract: ${reason}.`,
    code: "invalid-output",
    tier: tier ?? chatbotLlmTierIds.tier3FormFallback,
    isRetryable: false,
  })
}

function outputContractError(
  tier: ChatbotLlmTier,
  rejection: ChatbotLlmOutputContractRejection,
): ChatbotLlmError {
  return new ChatbotLlmError({
    message: `Chatbot LLM response violated the shared output contract: ${rejection.reason}.`,
    code: "invalid-output",
    tier,
    isRetryable: false,
    cause: rejection,
  })
}

function validateDisplayEnvelopeUiPayload(
  value: unknown,
  tier: ChatbotLlmTier | undefined,
): ChatbotLlmDisplayEnvelope["uiPayload"] {
  const payload = asRecord(value)
  if (!payload || typeof payload.kind !== "string") {
    throw invalidContractError(tier, "displayEnvelope.uiPayload must be a known payload")
  }
  if (payload.kind === "none") return { kind: "none" }
  if (payload.kind === "booking-card") {
    if (payload.args !== undefined && !asRecord(payload.args)) {
      throw invalidContractError(tier, "displayEnvelope.uiPayload booking args must be an object")
    }
    return { kind: "booking-card", ...(payload.args ? { args: payload.args as Record<string, unknown> } : {}) }
  }
  if (payload.kind === "choice-panel") {
    const choiceSet = asRecord(payload.choiceSet)
    const normalized = choiceSet ? normalizeChatbotLlmChoiceSet(choiceSet) : undefined
    if (!normalized) throw invalidContractError(tier, "displayEnvelope.uiPayload choice set must be valid")
    return { kind: "choice-panel", choiceSet: normalized }
  }
  if (payload.kind === "invalid" && isOutputContractRejectionReason(payload.reason)) {
    return { kind: "invalid", reason: payload.reason }
  }
  throw invalidContractError(tier, "displayEnvelope.uiPayload must be a known payload")
}

function isOutputContractRejectionReason(value: unknown): value is ChatbotLlmOutputContractRejectionReason {
  return (
    value === "missing-structured-ui" ||
    value === "choice-set-id-not-allowlisted" ||
    value === "choice-set-question-missing" ||
    value === "choice-set-question-too-long" ||
    value === "choice-set-choice-count-out-of-range" ||
    value === "choice-set-choice-invalid"
  )
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function isChatbotLlmTier(value: unknown): value is ChatbotLlmTier {
  return typeof value === "string" && (chatbotLlmTiers as ReadonlyArray<string>).includes(value)
}

function isDisplayEnvelopeSource(value: unknown): value is ChatbotLlmDisplayEnvelope["source"] {
  return value === "customer-reply-tag" || value === "json-customer-reply" || value === "trusted-server-display"
}

function isDisplayEnvelopeReason(value: unknown): value is ChatbotLlmDisplayEnvelope["reasons"][number] {
  return (
    value === "missing-explicit-display-boundary" ||
    value === "empty-display-text" ||
    value === "unsafe-display-candidate" ||
    value === "unsafe-fallback-text" ||
    value === "trusted-server-display"
  )
}
