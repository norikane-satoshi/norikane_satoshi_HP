import type { ChatbotMessageRole, ConversationState, JobContext } from "@/lib/chatbot/domain"

export type ChatbotLlmTier =
  | "local-deterministic"
  | "tier-1-chrome-notion-ai"
  | "tier-2-hosted-chrome-notion-ai"
  | "tier-3-gemini-flash"
  | "tier-3-ollama-deepseek"
  | "tier-4-form-fallback"

const chatbotLlmTiers = [
  "local-deterministic",
  "tier-1-chrome-notion-ai",
  "tier-2-hosted-chrome-notion-ai",
  "tier-3-gemini-flash",
  "tier-3-ollama-deepseek",
  "tier-4-form-fallback",
] as const

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
  "tier-3-ollama-deepseek",
  "tier-4-form-fallback",
] as const

function invalidContractError(tier: ChatbotLlmTier | undefined, reason: string): ChatbotLlmError {
  return new ChatbotLlmError({
    message: `Chatbot LLM response violated the shared contract: ${reason}.`,
    code: "invalid-output",
    tier: tier ?? "tier-4-form-fallback",
    isRetryable: false,
  })
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
