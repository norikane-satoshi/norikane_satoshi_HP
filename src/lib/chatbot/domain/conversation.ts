import type { RoutingDecision } from "@/lib/chatbot/domain/routing-decision"
import type { SurveyChoiceSet } from "@/lib/chatbot/domain/survey-choice"
import type { JobContext } from "@/lib/chatbot/domain/workflow-estimate"

export type ChatbotMessageRole = "user" | "assistant" | "system"

export type ChatbotMessage = {
  id: string
  role: ChatbotMessageRole
  content: string
  createdAt: string
}

export type ChatbotConversationContext = {
  sessionId: string
  userId?: string
  customerEmail?: string
  currentQuestion?: string
  activeChoices?: SurveyChoiceSet
  jobContext?: Partial<JobContext>
  routingDecision?: RoutingDecision
}

export type ChatbotConversation = {
  id: string
  startedAt: string
  updatedAt: string
  status: "open" | "handoff-email" | "handoff-booking" | "direct-contact" | "closed"
  context: ChatbotConversationContext
  messages: ChatbotMessage[]
}

export type ConversationState = {
  hasFinalMedium: boolean
  hasJobKind: boolean
  hasAdditionalWork: boolean
  hasDocumentaryAttachments: boolean
  hasWorkSite: boolean
  hasReferenceUrls: boolean
  hasContactEmail: boolean
  hasDesiredSchedule: boolean
  turnCount: number
  outOfScope?: boolean
  technicalQuestion?: boolean
  workReviewRequest?: boolean
  vfxCgHeavy?: boolean
  editingIncomplete?: boolean
  lookDecomposerDetail?: boolean
  daysUntilStart?: number
  contactEmail?: string
  contactName?: string
  customerName?: string
  companyName?: string
}
