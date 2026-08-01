import type {
  ChatbotMessageRole,
  ConversationState,
  JobContext,
  SurveyChoiceSet,
} from "@/lib/chatbot/domain"

export type ChatbotLlmTier =
  | "tier-1-chrome-notion-ai"
  | "tier-2-hosted-chrome-notion-ai"
  | "tier-3-gemini-flash"
  | "tier-4-form-fallback"

const chatbotLlmTiers = [
  "tier-1-chrome-notion-ai",
  "tier-2-hosted-chrome-notion-ai",
  "tier-3-gemini-flash",
  "tier-4-form-fallback",
] as const

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

  const outputContract = inspectChatbotLlmStructuredUiContract(record.rawText)
  if (outputContract.kind === "rejected-choice-panel") {
    throw outputContractError(record.tier, {
      boundary: "llm-output-contract",
      decision: "reject-and-regenerate-structured-ui",
      reason: outputContract.reason,
    })
  }
  if (record.tier === "tier-3-gemini-flash" && outputContract.kind === "none") {
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
 * Tier 4 is the final deterministic form fallback chosen after all AI assistant
 * tiers fail.
 */
export const defaultLlmTierOrder: ReadonlyArray<ChatbotLlmTier> = [
  "tier-1-chrome-notion-ai",
  "tier-2-hosted-chrome-notion-ai",
  "tier-3-gemini-flash",
  "tier-4-form-fallback",
] as const

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
  if (process.env.NODE_ENV === "test") return
  console.info(
    JSON.stringify({
      event: "chatbot_llm_output_contract_boundary",
      requestId: input.requestId,
      tier: input.tier,
      boundary: input.rejection.boundary,
      decision: input.rejection.decision,
      reason: input.rejection.reason,
    }),
  )
}

export function normalizeChatbotLlmChoiceSet(value: Record<string, unknown>): SurveyChoiceSet | undefined {
  const result = inspectChatbotLlmChoiceSet(value)
  return result.ok ? result.choiceSet : undefined
}

function invalidContractError(tier: ChatbotLlmTier | undefined, reason: string): ChatbotLlmError {
  return new ChatbotLlmError({
    message: `Chatbot LLM response violated the shared contract: ${reason}.`,
    code: "invalid-output",
    tier: tier ?? "tier-4-form-fallback",
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

type StructuredUiContractInspection =
  | { kind: "none" }
  | { kind: "choice-panel"; choiceSet: SurveyChoiceSet }
  | { kind: "booking-card" }
  | { kind: "rejected-choice-panel"; reason: ChatbotLlmOutputContractRejectionReason }

function inspectChatbotLlmStructuredUiContract(rawText: string): StructuredUiContractInspection {
  for (const candidate of extractJsonObjectCandidates(rawText)) {
    const parsed = parseJson(candidate)
    if (!isRecord(parsed)) continue
    if (parsed.tool === "show_booking_card") return { kind: "booking-card" }
    if (parsed.tool !== "show_choice_panel") continue
    if (!isRecord(parsed.args)) {
      return { kind: "rejected-choice-panel", reason: "choice-set-id-not-allowlisted" }
    }

    const result = inspectChatbotLlmChoiceSet(parsed.args)
    return result.ok
      ? { kind: "choice-panel", choiceSet: result.choiceSet }
      : { kind: "rejected-choice-panel", reason: result.reason }
  }

  return { kind: "none" }
}

const llmChoicePanelIds = new Set([
  "job-kind",
  "project-length",
  "final-medium",
  "additional-work",
  "documentary-attachment",
  "work-site",
  "production-options",
])

function inspectChatbotLlmChoiceSet(value: Record<string, unknown>):
  | { ok: true; choiceSet: SurveyChoiceSet }
  | { ok: false; reason: ChatbotLlmOutputContractRejectionReason } {
  const id = optionalString(value.id)
  if (!id || !llmChoicePanelIds.has(id)) {
    return { ok: false, reason: "choice-set-id-not-allowlisted" }
  }

  const question = optionalString(value.question)
  if (!question) return { ok: false, reason: "choice-set-question-missing" }
  if (question.length > 140) return { ok: false, reason: "choice-set-question-too-long" }

  const rawChoices = Array.isArray(value.choices) ? value.choices : []
  if (rawChoices.length < 2 || rawChoices.length > 10) {
    return { ok: false, reason: "choice-set-choice-count-out-of-range" }
  }
  const choices = rawChoices.map(normalizeChatbotLlmChoice)
  if (choices.some((choice) => !choice)) {
    return { ok: false, reason: "choice-set-choice-invalid" }
  }

  return {
    ok: true,
    choiceSet: {
      id,
      question,
      choices: choices as SurveyChoiceSet["choices"],
      ...(value.selectionMode === "multiple" ? { selectionMode: "multiple" as const } : {}),
      ...(value.allowFreeText === true ? { allowFreeText: true } : {}),
    },
  }
}

function normalizeChatbotLlmChoice(value: unknown): SurveyChoiceSet["choices"][number] | undefined {
  if (!isRecord(value)) return undefined
  const id = optionalString(value.id)
  const label = optionalString(value.label)
  if (!id || !label) return undefined
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(id)) return undefined
  if (label.length > 80) return undefined
  return { id, label }
}

function extractJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = []
  const fencedPattern = /```(?:json)?\s*([\s\S]*?)```/giu
  let match: RegExpExecArray | null
  while ((match = fencedPattern.exec(text))) {
    const body = match[1]?.trim()
    if (body?.startsWith("{") && body.endsWith("}")) candidates.push(body)
  }

  const trimmed = text.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) candidates.push(trimmed)
  const firstBrace = text.indexOf("{")
  const lastBrace = text.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1))
  return [...new Set(candidates)]
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
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
