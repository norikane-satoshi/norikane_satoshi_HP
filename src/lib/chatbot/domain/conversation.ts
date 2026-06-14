import type { RoutingDecision } from "@/lib/chatbot/domain/routing-decision"
import type { SurveyChoiceSet } from "@/lib/chatbot/domain/survey-choice"
import type { JobContext } from "@/lib/chatbot/domain/workflow-estimate"

export type ChatbotMessageRole = "user" | "assistant" | "system"

export type ChatbotMessage = {
  id: string
  role: ChatbotMessageRole
  content: string
  llmModel?: string | null
  createdAt: string
}

export type ChatbotConversationContext = {
  sessionId: string
  userId?: string
  notionAiThreadId?: string
  customerEmail?: string
  currentQuestion?: string
  activeChoices?: SurveyChoiceSet
  conversationState?: Partial<ConversationState>
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
  hasProjectLength: boolean
  hasMaterialHandoff?: boolean
  hasMaterialDetails?: boolean
  hasAdditionalWork: boolean
  hasDocumentaryAttachments: boolean
  hasWorkSite: boolean
  hasReferenceUrls: boolean
  hasDeliveryFormat?: boolean
  hasProductionOptions?: boolean
  hasBudgetRange?: boolean
  hasContactEmail: boolean
  hasDesiredSchedule: boolean
  hasCustomerIdentity?: boolean
  hasProjectTitle?: boolean
  hasPendingRemoteWorkSiteRecommendation?: boolean
  declinedRemoteWorkSiteRecommendation?: boolean
  hasPendingAdditionalWorkOther?: boolean
  turnCount: number
  outOfScope?: boolean
  technicalQuestion?: boolean
  workReviewRequest?: boolean
  portfolioQuestion?: boolean
  vfxCgHeavy?: boolean
  editingIncomplete?: boolean
  asksPricing?: boolean
  contractDecision?: boolean
  personalQuestion?: boolean
  otherClientInformation?: boolean
  confidentialTechniqueQuestion?: boolean
  privateMethodNameExposure?: boolean
  daysUntilStart?: number
  contactEmail?: string
  customerName?: string
  companyName?: string
  projectTitle?: string
  additionalWorkOtherNote?: string
  productionOptions?: Array<"captions" | "telops" | "narration" | "music">
}

export type ChatbotBookingPrefill = {
  projectTitle?: string
  contactName?: string
  companyName?: string
  contactEmail?: string
  dueDate?: string
}
