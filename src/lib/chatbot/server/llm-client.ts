import type { ChatbotMessageRole, ConversationState, JobContext } from "@/lib/chatbot/domain"

export type ChatbotLlmTier =
  | "local-deterministic"
  | "tier-1-chrome-notion-ai"
  | "tier-2-hosted-chrome-notion-ai"
  | "tier-3-gemini-flash"
  | "tier-3-ollama-deepseek"
  | "tier-4-form-fallback"

export type ChatbotLlmRequest = {
  systemPrompt: string
  messages: ReadonlyArray<{ role: ChatbotMessageRole; content: string }>
  conversationState: ConversationState
  jobContext: JobContext
  latestUserMessage?: string
  temperature?: number
  maxOutputTokens?: number
}

export type ChatbotLlmResponse = {
  rawText: string
  tokensUsed?: number
  latencyMs?: number
  tier: ChatbotLlmTier
  diagnostics?: Record<string, unknown>
}

export interface ChatbotLlmClient {
  readonly tier: ChatbotLlmTier
  generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse>
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
