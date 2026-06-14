import type {
  BookingCardPrefill,
  ChatbotMessageRole,
  ConversationState,
  JobContext,
  RoutingDecision,
} from "@/lib/chatbot/domain"

export type WidgetAssistantMessage = {
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
      bookingPrefill?: BookingCardPrefill
    }
  | {
      kind: "direct-contact-card"
      reason: Extract<RoutingDecision, { kind: "to-direct-contact" }>["reason"]
      suggestedMessage: string
    }
  | { kind: "tier4-inquiry-form" }

export type ChatbotMessageResponse = {
  conversationId: string
  assistantMessage: WidgetAssistantMessage
  routingDecision?: RoutingDecision
  tier: "tier-1-chrome-notion-ai" | "tier-2-ollama-deepseek" | "tier-4-form-fallback"
  ui: WidgetUi
}

export type SubmitChatbotMessageInput = {
  message: string
  conversationId?: string
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

export async function submitChatbotMessage(input: SubmitChatbotMessageInput): Promise<ChatbotMessageResponse> {
  const response = await fetch("/api/chatbot/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

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
