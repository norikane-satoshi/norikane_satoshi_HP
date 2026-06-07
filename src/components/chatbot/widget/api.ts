import type { ChatbotMessageRole, ConversationState, JobContext, RoutingDecision } from "@/lib/chatbot/domain"

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
      jobContext: JobContext
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
  | "tier-1-chrome-notion-ai"
  | "tier-2-hosted-chrome-notion-ai"
  | "tier-3-ollama-deepseek"
  | "tier-4-form-fallback"

export type ChatbotMessageResponse = {
  conversationId: string
  userMessage: WidgetAssistantMessage
  assistantMessage: WidgetAssistantMessage
  routingDecision?: RoutingDecision
  tier: ChatbotResponseTier
  tierAttempts?: ChatbotTierAttemptDebug[]
  ui: WidgetUi
}

export type ChatbotTierAttemptDebug = {
  tier: ChatbotResponseTier
  phase: "health-check" | "generate"
  outcome: "healthy" | "unhealthy" | "success" | "error"
  latencyMs: number
  attempt?: number
  errorCode?: string
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

export function isChatbotRequestCancelledError(error: unknown): error is ChatbotRequestCancelledError {
  return error instanceof ChatbotRequestCancelledError
}

type SubmitChatbotMessageOptions = {
  signal?: AbortSignal
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  )
}

export async function submitChatbotMessage(
  input: SubmitChatbotMessageInput,
  options: SubmitChatbotMessageOptions = {},
): Promise<ChatbotMessageResponse> {
  let response: Response
  try {
    response = await fetch("/api/chatbot/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: options.signal,
    })
  } catch (error) {
    if (isAbortError(error)) throw new ChatbotRequestCancelledError()
    throw error
  }

  if (!response.ok) throw new Error("chatbot_message_failed")
  return (await response.json()) as ChatbotMessageResponse
}

export async function submitChatbotInquiry(input: SubmitInquiryInput): Promise<void> {
  const response = await fetch("/api/chatbot/submit-inquiry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  if (!response.ok) throw new Error("chatbot_inquiry_failed")
}
