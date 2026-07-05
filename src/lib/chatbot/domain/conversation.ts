import type { RoutingDecision } from "@/lib/chatbot/domain/routing-decision"
import type { BookingCardPrefill } from "@/lib/chatbot/domain/routing-decision"
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
  bookingFinalConfirmation?: {
    status: "pending" | "confirmed" | "supplemental-received"
    requestedAtTurn?: number
    confirmedAtTurn?: number
    supplementalNote?: string
    bookingPrefill?: BookingCardPrefill
  }
  bookingReadiness?: {
    finalQuestionOffered?: boolean
    finalQuestionOfferedAtTurn?: number
    additionalConcernStatus?: "none" | "has-concern" | "unknown"
    additionalConcernSource?: "choice-panel" | "llm-booking-card" | "fallback-pattern"
    additionalConcernUpdatedAtTurn?: number
  }
  bookingSubmission?: {
    status: "submitted"
    reservationNumber: string
    submittedAt?: string
  }
  activeIntakeClarification?: {
    status: "needs-clarification" | "unknown-but-acceptable"
    choiceSetId?: SurveyChoiceSet["id"]
    selectedChoiceIds?: SurveyChoiceSet["choices"][number]["id"][]
    question: string
    reason: string
    answerPreview?: string
    requestedAtTurn?: number
  }
  intakeClarifications?: Record<
    string,
    {
      status: "clear" | "needs-clarification" | "unknown-but-acceptable"
      reason?: string
      answerPreview?: string
      updatedAtTurn?: number
    }
  >
  durationContext?: {
    workflowFacts?: Partial<
      Pick<JobContext, "jobKind" | "finalMedium" | "deliveryMedium" | "workSite" | "projectLengthMinutes" | "additionalWork">
    >
    workflowEstimate?: Pick<
      WorkflowEstimate,
      | "totalMinDays"
      | "totalMaxDays"
      | "riskFlags"
      | "estimateStatus"
      | "referencePresetId"
      | "referenceMinDays"
      | "referenceMaxDays"
      | "unsupportedReason"
    >
    knowledgeSyncedAt?: string
    snapshotStatus: "current" | "missing"
  }
}
