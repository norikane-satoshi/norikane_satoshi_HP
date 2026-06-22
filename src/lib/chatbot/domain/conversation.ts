import type { RoutingDecision } from "@/lib/chatbot/domain/routing-decision"
import type { SurveyChoiceSet } from "@/lib/chatbot/domain/survey-choice"
import type { JobContext, WorkflowEstimate } from "@/lib/chatbot/domain/workflow-estimate"

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
  customerEmail?: string
  slackThreadTs?: string
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
  requestKind?: "production" | "lecture-training"
  hasFinalMedium: boolean
  hasJobKind: boolean
  hasProjectLength?: boolean
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
  turnCount: number
  outOfScope?: boolean
  technicalQuestion?: boolean
  workReviewRequest?: boolean
  vfxCgHeavy?: boolean
  editingIncomplete?: boolean
  lookDecomposerDetail?: boolean
  asksPricing?: boolean
  contractDecision?: boolean
  personalQuestion?: boolean
  otherClientInformation?: boolean
  confidentialTechniqueQuestion?: boolean
  privateMethodNameExposure?: boolean
  hasLectureTrainingIntent?: boolean
  hasLectureTrainingContent?: boolean
  hasLectureTrainingVenue?: boolean
  hasLectureTrainingSoftware?: boolean
  hasResolveVersion?: boolean
  hasControlPanel?: boolean
  hasAudienceGuiDisplay?: boolean
  hasInstructorMonitorSetup?: boolean
  hasPreferredLectureSchedule?: boolean
  requiresNorikaneConfirmation?: boolean
  lectureTrainingInquiry?: {
    content?: string
    venue?: string
    software?: "davinci-resolve" | "davinci-resolve-studio"
    unsupportedSoftware?: string
    resolveVersion?: string
    controlPanel?: string
    audienceGuiDisplay?: string
    instructorMonitorSetup?: string
    preferredSchedule?: string
  }
  daysUntilStart?: number
  contactEmail?: string
  customerName?: string
  companyName?: string
  productionOptions?: Array<"captions" | "telops" | "narration" | "music" | "other">
  otherChoiceComments?: Record<string, string>
  durationContext?: {
    workflowFacts?: Partial<
      Pick<JobContext, "jobKind" | "finalMedium" | "workSite" | "projectLengthMinutes" | "additionalWork">
    >
    workflowEstimate?: Pick<WorkflowEstimate, "totalMinDays" | "totalMaxDays" | "riskFlags">
    knowledgeSyncedAt?: string
    snapshotStatus: "current" | "missing"
  }
}
