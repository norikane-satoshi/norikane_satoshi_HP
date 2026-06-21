import type {
  BookingCardPrefill,
  ChatbotMessageRole,
  ConversationState,
  JobContext,
  RoutingDecision,
} from "@/lib/chatbot/domain"

export type WidgetAssistantMessage = {
  id: string
  role: ChatbotMessageRole
  content: string
  createdAt: string
}

export type WidgetUi =
  | { kind: "none" }
  | { kind: "choice-panel"; choiceSet: NonNullable<Extract<RoutingDecision, { kind: "continue" }>["presentChoices"]> }
  | {
      kind: "booking-card"
      suggestedSlots: Extract<RoutingDecision, { kind: "to-booking-inline" }>["suggestedSlots"]
      busyDateKeys?: Extract<RoutingDecision, { kind: "to-booking-inline" }>["busyDateKeys"]
      jobContext: JobContext
      bookingPrefill?: BookingCardPrefill
    }
  | {
      kind: "direct-contact-card"
      reason: Extract<RoutingDecision, { kind: "to-direct-contact" }>["reason"]
      suggestedMessage: string
    }
  | {
      kind: "consultation-summary-form"
      summary: Extract<RoutingDecision, { kind: "to-email" }>["summary"]
    }
  | { kind: "tier4-inquiry-form" }

export type ChatbotResponseTier =
  | "local-deterministic"
  | "tier-1-chrome-notion-ai"
  | "tier-2-hosted-chrome-notion-ai"
  | "tier-3-ollama-deepseek"
  | "tier-4-form-fallback"

export type ChatbotMessageResponse = {
  conversationId: string
  userMessage?: WidgetAssistantMessage
  assistantMessage: WidgetAssistantMessage
  routingDecision?: RoutingDecision
  tier: ChatbotResponseTier
  ui: WidgetUi
}

export type SubmitChatbotMessageInput = {
  message: string
  conversationId?: string
  editTargetMessageId?: string
  clientUserMessageId?: string
  clientSessionId?: string
  jobContext?: Partial<JobContext>
  conversationState?: Partial<ConversationState>
}

export type SubmitInquiryInput = {
  name: string
  email: string
  jobType: string
  duration: string
  desiredDeadline: string
  freeText: string
  conversationId?: string
}

export class ChatbotRequestCancelledError extends Error {
  constructor() {
    super("chatbot_message_cancelled")
    this.name = "ChatbotRequestCancelledError"
  }
}

export class ChatbotOperationError extends Error {
  readonly operation: "message" | "submit-inquiry" | "create-booking-from-chat"
  readonly status?: number
  readonly retryable: boolean
  readonly fallback: "tier4-inquiry-form"
  readonly requestId?: string
  readonly stage?: string

  constructor(input: {
    operation: ChatbotOperationError["operation"]
    status?: number
    retryable: boolean
    fallback?: "tier4-inquiry-form"
    requestId?: string
    stage?: string
    message?: string
  }) {
    super(input.message ?? "chatbot_operation_failed")
    this.name = "ChatbotOperationError"
    this.operation = input.operation
    this.status = input.status
    this.retryable = input.retryable
    this.fallback = input.fallback ?? "tier4-inquiry-form"
    this.requestId = input.requestId
    this.stage = input.stage
  }
}

export function isChatbotRequestCancelledError(error: unknown): error is ChatbotRequestCancelledError {
  return error instanceof ChatbotRequestCancelledError
}

export function isChatbotOperationError(error: unknown): error is ChatbotOperationError {
  return error instanceof ChatbotOperationError
}

type SubmitChatbotMessageOptions = {
  signal?: AbortSignal
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  )
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function shouldRetryFetchFailure(error: unknown): boolean {
  if (isAbortError(error)) return false
  if (error instanceof ChatbotOperationError) return error.retryable
  return error instanceof TypeError || error instanceof Error
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function operationErrorFromResponse(
  operation: ChatbotOperationError["operation"],
  response: Response,
  body: unknown,
): ChatbotOperationError {
  const failure =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { requestId?: unknown; failure?: { retryable?: unknown; fallback?: unknown; stage?: unknown }; error?: unknown })
      : {}
  const retryable =
    typeof failure.failure?.retryable === "boolean"
      ? failure.failure.retryable
      : isRetryableStatus(response.status)
  const fallback = failure.failure?.fallback === "tier4-inquiry-form" ? "tier4-inquiry-form" : undefined

  return new ChatbotOperationError({
    operation,
    status: response.status,
    retryable,
    fallback,
    requestId: typeof failure.requestId === "string" ? failure.requestId : undefined,
    stage: typeof failure.failure?.stage === "string" ? failure.failure.stage : undefined,
    message: typeof failure.error === "string" ? failure.error : undefined,
  })
}

export async function postChatbotJson<T>(
  operation: ChatbotOperationError["operation"],
  path: string,
  input: unknown,
  options: SubmitChatbotMessageOptions = {},
): Promise<T> {
  const maxAttempts = 2
  let latestError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: options.signal,
      })
      const body = await parseJsonResponse(response)
      if (response.ok) return body as T
      throw operationErrorFromResponse(operation, response, body)
    } catch (error) {
      if (isAbortError(error)) throw new ChatbotRequestCancelledError()
      latestError = error
      if (attempt < maxAttempts && shouldRetryFetchFailure(error)) {
        console.warn("[CHATBOT_CLIENT_RETRY]", {
          event: "chatbot_client_retry",
          operation,
          attempt,
          status: error instanceof ChatbotOperationError ? error.status : undefined,
          requestId: error instanceof ChatbotOperationError ? error.requestId : undefined,
          stage: error instanceof ChatbotOperationError ? error.stage : undefined,
        })
        continue
      }
      break
    }
  }

  if (latestError instanceof ChatbotOperationError) throw latestError
  throw new ChatbotOperationError({
    operation,
    retryable: true,
    message: latestError instanceof Error ? latestError.message : "chatbot_network_failed",
  })
}

export async function submitChatbotMessage(
  input: SubmitChatbotMessageInput,
  options: SubmitChatbotMessageOptions = {},
): Promise<ChatbotMessageResponse> {
  return postChatbotJson<ChatbotMessageResponse>("message", "/api/chatbot/message", input, options)
}

export async function submitChatbotInquiry(input: SubmitInquiryInput): Promise<void> {
  await postChatbotJson("submit-inquiry", "/api/chatbot/submit-inquiry", input)
}
