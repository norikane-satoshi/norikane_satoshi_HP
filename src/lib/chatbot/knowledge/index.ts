export { satoshiProfileKnowledge } from "@/lib/chatbot/knowledge/satoshi-profile"
export { videoIndustryKnowledge } from "@/lib/chatbot/knowledge/video-industry"
export { featuredWorksKnowledge } from "@/lib/chatbot/knowledge/works"
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
  conversationRetentionDays,
  enforceAssistantQuestionLimit,
  initialIntakeQuestions,
  maxQuestionsPerAssistantResponse,
  removeForbiddenAssistantSurface,
  stripInternalAssistantMarkup,
} from "@/lib/chatbot/knowledge/response-policy"
export {
  additionalWorkDurationRules,
  candidateWindowGranularityByJobKind,
  mediumStrictnessRank,
  workflowDurationPresets,
  workSiteDurationRules,
} from "@/lib/chatbot/knowledge/workflow-duration"
export type { WorkflowDurationPreset } from "@/lib/chatbot/knowledge/workflow-duration"
