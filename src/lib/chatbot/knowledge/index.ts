export { satoshiProfileKnowledge } from "@/lib/chatbot/knowledge/satoshi-profile"
export { videoIndustryKnowledge } from "@/lib/chatbot/knowledge/video-industry"
export {
  approvedSourceNotes,
  approvedSourceNotesKnowledge,
} from "@/lib/chatbot/knowledge/source-notes"
export type { ChatbotApprovedSourceNote } from "@/lib/chatbot/knowledge/source-notes"
export {
  chatbotForbiddenTopics,
  directContactPolicyMessage,
} from "@/lib/chatbot/knowledge/forbidden-topics"
export type {
  ChatbotForbiddenTopic,
  ChatbotForbiddenTopicId,
} from "@/lib/chatbot/knowledge/forbidden-topics"
export {
  buildChatbotStaticPolicyPrompt,
  chatbotPersonaPolicy,
  containsPriceQuote,
  conversationRetentionHours,
  enforceAssistantQuestionLimit,
  initialIntakeQuestions,
  maxQuestionsPerAssistantResponse,
  removeForbiddenAssistantSurface,
} from "@/lib/chatbot/knowledge/response-policy"
export {
  additionalWorkDurationRules,
  candidateWindowGranularityByJobKind,
  mediumStrictnessRank,
  workflowDurationPresets,
  workSiteDurationRules,
} from "@/lib/chatbot/knowledge/workflow-duration"
export type { WorkflowDurationPreset } from "@/lib/chatbot/knowledge/workflow-duration"
