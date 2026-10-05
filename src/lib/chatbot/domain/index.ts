export type {
  ChatbotConversation,
  ChatbotConversationContext,
  ChatbotMessage,
  ChatbotMessageRole,
  ConversationState,
  InquiryFormPrefill,
} from "@/lib/chatbot/domain/conversation"
export {
  buildBookingConfirmationItems,
  formatConsultationSummary,
  hasRequiredConsultationNotificationSlots,
  hasRequiredEmailConsultationSlots,
} from "@/lib/chatbot/domain/consultation-summary"
export type { ConsultationSummaryInput } from "@/lib/chatbot/domain/consultation-summary"
export type { BookingCardPrefill, RoutingDecision } from "@/lib/chatbot/domain/routing-decision"
export {
  additionalWorkChoices,
  bookingFinalConfirmationChoices,
  customerFacingWorkSiteChoices,
  documentaryAttachmentChoices,
  deliveryFormatChoices,
  dcpRequiredChoices,
  dcpCreatorChoices,
  finalMediumChoices,
  jobKindChoices,
  materialTimingChoices,
  referenceUrlChoices,
  lectureTrainingContentChoices,
  lectureTrainingFormatChoices,
  lectureTrainingSoftwareChoices,
  projectLengthChoices,
  projectLengthChoicesForJobKind,
  productionOptionChoices,
  surveyChoiceSets,
  workSiteChoices,
} from "@/lib/chatbot/domain/survey-choice"
export type { SurveyChoice, SurveyChoiceSet } from "@/lib/chatbot/domain/survey-choice"
export type {
  CandidateWindow,
  ConversationSummary,
  DeliveryMedium,
  DocumentaryAttachment,
  DocumentaryAttachmentItem,
  FinalMedium,
  JobContext,
  JobKind,
  WorkflowEstimate,
  WorkflowStage,
  WorkSite,
} from "@/lib/chatbot/domain/workflow-estimate"
export { formatProjectLengthMinutes, parseProjectLengthMinutes } from "./project-length"
export { jobKindLabels } from "./job-kind-label"
export {
  describeWorkSchedule,
  planWorkSchedule,
  workScheduleDayCounts,
  workScheduleRoleLabels,
  type WorkScheduleDay,
  type WorkSchedulePlan,
  type WorkScheduleRole,
} from "./work-schedule"

export { projectConditionDefinitions, getProjectConditionDefinition, isConditionVisible, formatConditionAnswer, projectConditionDetails, validateConditionAnswers, sanitizeConditionAnswers } from "@/lib/booking/domain/project-conditions"
export type { ConditionAnswer, ConditionAnswers, ConditionAnswerIssue, ConditionAnswersValidation, ProjectConditionId, ProjectConditionDefinition } from "@/lib/booking/domain/project-conditions"
export { normalizeJobKind, workflowPresetJobKind } from "@/lib/booking/domain/job-kind"
export { totalWorkCompositionSeconds, totalWorkCompositionMinutes, formatWorkComposition } from "@/lib/booking/domain/work-composition"
export type { WorkCompositionRow } from "@/lib/booking/domain/work-composition"
