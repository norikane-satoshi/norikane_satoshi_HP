export {
  CHATBOT_CONVERSATION_RETENTION_DAYS,
  cleanupExpiredChatbotConversations,
} from "@/lib/chatbot/server/cleanup-conversations"
export type { CleanupExpiredChatbotConversationsResult } from "@/lib/chatbot/server/cleanup-conversations"
export {
  appendMessage,
  createConversation,
  loadConversationById,
  linkChatToBookingGroup,
  linkConversationToUser,
  loadConversationBySessionId,
  recordInquiry,
  recordSurveyResponse,
  setConversationNotionAiThreadId,
  truncateConversationFromMessage,
  updateConversationRouting,
} from "@/lib/chatbot/server/repository"
export {
  applyAdditionalWorkAdjustment,
  applyWorkSiteAdjustment,
  estimateBaseDuration,
  estimateWorkflow,
} from "@/lib/chatbot/server/duration-estimator"
export type { JobKind } from "@/lib/chatbot/server/duration-estimator"
export {
  ChatbotAvailabilityError,
  findCandidateWindows,
} from "@/lib/chatbot/server/availability-finder"
export type {
  AttendanceConflictResolver,
  FreeBusyFetcher,
} from "@/lib/chatbot/server/availability-finder"
export { decideRoutingFallback } from "@/lib/chatbot/server/routing"
export type { RoutingDecisionInput } from "@/lib/chatbot/server/routing"
export { classifyChatbotTopic } from "@/lib/chatbot/server/topic-gate"
export type { TopicGateResult } from "@/lib/chatbot/server/topic-gate"
export { ChatbotLlmError, defaultLlmTierOrder } from "@/lib/chatbot/server/llm-client"
export type {
  ChatbotLlmClient,
  ChatbotLlmRequest,
  ChatbotLlmResponse,
  ChatbotLlmTier,
} from "@/lib/chatbot/server/llm-client"
export { createChatbotLlmTierOrchestrator } from "@/lib/chatbot/server/llm-orchestrator"
export type {
  ChatbotLlmTierOrchestrator,
  TierAttemptEvent,
} from "@/lib/chatbot/server/llm-orchestrator"
export {
  createLocalChatbotTierAttemptLogger,
  formatChatbotTierAttemptLogEvent,
} from "@/lib/chatbot/server/llm-tier-attempt-logger"
export type { ChatbotTierAttemptLogEvent } from "@/lib/chatbot/server/llm-tier-attempt-logger"
export {
  createTier1ChromeNotionAiClient,
  tier1ObservedNotionAiModel,
  Tier1ChromeNotionAiClient,
} from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai"
export { runTier1HealthCheck } from "@/lib/chatbot/server/llm-clients/tier1-health-check"
export {
  createTier2HostedChromeNotionAiClient,
  Tier2HostedChromeNotionAiClient,
} from "@/lib/chatbot/server/llm-clients/tier2-hosted-chrome-notion-ai"
export {
  createTier3OllamaDeepSeekClient,
  Tier3OllamaDeepSeekClient,
} from "@/lib/chatbot/server/llm-clients/tier3-ollama-deepseek"
export {
  createTier4FormFallbackClient,
  Tier4FormFallbackClient,
} from "@/lib/chatbot/server/llm-clients/tier4-form-fallback"
export { normalizeChatbotLlmResponse } from "@/lib/chatbot/server/llm-response-normalizer"
export {
  formatUserChatbotContextForPrompt,
  loadUserChatbotContext,
} from "@/lib/chatbot/server/user-context-loader"
export type { UserChatbotContext } from "@/lib/chatbot/server/user-context-loader"
export {
  createHostedWorkerQueue,
  createHostedWorkerRequestHandler,
  createHostedWorkerRuntimeState,
  createHostedWorkerServer,
  ensureHostedWorkerChrome,
  generateHostedWorkerResponse,
  getHostedWorkerHealth,
  hostedWorkerTier,
  inspectHostedWorkerChrome,
  resolveHostedWorkerChromeConfig,
  startHostedWorkerServer,
} from "@/lib/chatbot/hosted-worker"
export type {
  HostedWorkerChromeConfig,
  HostedWorkerEnsureResult,
  HostedWorkerGenerateRequest,
  HostedWorkerGenerateResponse,
  HostedWorkerHealthResponse,
  HostedWorkerQueueState,
  HostedWorkerRuntimeState,
} from "@/lib/chatbot/hosted-worker"
