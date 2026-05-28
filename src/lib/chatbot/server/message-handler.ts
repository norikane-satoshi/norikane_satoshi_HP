import type {
  ChatbotConversation,
  ChatbotMessage,
  ConversationState,
  JobContext,
  RoutingDecision,
} from "@/lib/chatbot/domain"
import {
  appendMessage,
  createChatbotLlmTierOrchestrator,
  createLocalChatbotTierAttemptLogger,
  createConversation,
  createTier1ChromeNotionAiClient,
  createTier2OllamaDeepSeekClient,
  createTier4FormFallbackClient,
  formatUserChatbotContextForPrompt,
  linkConversationToUser,
  loadUserChatbotContext,
  loadConversationBySessionId,
  updateConversationRouting,
  type ChatbotLlmClient,
  type ChatbotLlmResponse,
  type ChatbotLlmTierOrchestrator,
  decideRoutingFallback,
  type UserChatbotContext,
  normalizeChatbotLlmResponse,
  tier1ObservedNotionAiModel,
} from "@/lib/chatbot/server"
import { buildChatbotStaticPolicyPrompt } from "@/lib/chatbot/knowledge"
import { classifyChatbotTopic } from "@/lib/chatbot/server/topic-gate"

type ChatbotMessageUi =
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
  | { kind: "tier4-inquiry-form" }

export type ChatbotMessageApiResult = {
  conversationId: string
  assistantMessage: Pick<ChatbotMessage, "role" | "content" | "createdAt">
  routingDecision?: RoutingDecision
  tier: ChatbotLlmResponse["tier"]
  ui: ChatbotMessageUi
}

export type HandleChatbotMessageInput = {
  sessionId: string
  userId?: string
  message: string
  conversationId?: string
  jobContext?: Partial<JobContext>
  conversationState?: Partial<ConversationState>
}

type ChatbotMessageRepository = {
  loadConversationBySessionId: typeof loadConversationBySessionId
  createConversation: typeof createConversation
  appendMessage: typeof appendMessage
  updateConversationRouting: typeof updateConversationRouting
  linkConversationToUser: typeof linkConversationToUser
}

type HandleChatbotMessageOptions = {
  repository?: ChatbotMessageRepository
  orchestratorFactory?: () => ChatbotLlmTierOrchestrator
  userContextLoader?: typeof loadUserChatbotContext
  userContextFormatter?: typeof formatUserChatbotContextForPrompt
}

const defaultRepository: ChatbotMessageRepository = {
  loadConversationBySessionId,
  createConversation,
  appendMessage,
  updateConversationRouting,
  linkConversationToUser,
}

export async function handleChatbotMessage(
  input: HandleChatbotMessageInput,
  options: HandleChatbotMessageOptions = {},
): Promise<ChatbotMessageApiResult> {
  const repository = options.repository ?? defaultRepository
  const orchestrator = options.orchestratorFactory?.() ?? createDefaultChatbotLlmOrchestrator()
  const userContextLoader = options.userContextLoader ?? loadUserChatbotContext
  const userContextFormatter = options.userContextFormatter ?? formatUserChatbotContextForPrompt
  let conversation =
    (await repository.loadConversationBySessionId(input.sessionId)) ??
    (await repository.createConversation({ sessionId: input.sessionId, userId: input.userId ?? null }))

  if (shouldIsolateExistingConversation(conversation, input.userId)) {
    const isolatedSessionId = `${input.sessionId}:${input.userId ?? "anonymous"}`
    conversation =
      (await repository.loadConversationBySessionId(isolatedSessionId)) ??
      (await repository.createConversation({ sessionId: isolatedSessionId, userId: input.userId ?? null }))
  } else if (input.userId && conversation.context.userId !== input.userId) {
    await repository.linkConversationToUser({ conversationId: conversation.id, userId: input.userId })
  }

  const userMessage = await repository.appendMessage({
    conversationId: conversation.id,
    role: "user",
    content: input.message,
  })
  const userContext = input.userId
    ? await userContextLoader({
        userId: input.userId,
        currentConversationId: conversation.id,
      })
    : null
  const jobContext = buildJobContext(input.jobContext, conversation)
  const conversationState = buildConversationState(input.conversationState, conversation, userMessage)
  const llmResponse = await orchestrator.generate({
    systemPrompt: buildChatbotSystemPrompt(userContext, userContextFormatter),
    messages: [
      ...conversation.messages.map(({ role, content }) => ({ role, content })),
      { role: userMessage.role, content: userMessage.content },
    ],
    conversationState,
    jobContext,
    latestUserMessage: input.message,
    temperature: 0.2,
    maxOutputTokens: 900,
  })
  const deterministicRoutingDecision = decideRoutingFallback({
    jobContext,
    conversationState,
    latestUserMessage: input.message,
  })
  const routingDecision =
    deterministicRoutingDecision.kind === "to-direct-contact"
      ? deterministicRoutingDecision
      : llmResponse.proposedRoutingDecision ?? deterministicRoutingDecision
  const normalizedLlmResponse = normalizeChatbotLlmResponse(llmResponse, { routingDecision })
  const assistantMessage = await repository.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: normalizedLlmResponse.content,
  })

  if (routingDecision) {
    await repository.updateConversationRouting({
      conversationId: conversation.id,
      routingDecision: routingDecision.kind,
    })
  }

  return {
    conversationId: conversation.id,
    assistantMessage: {
      role: assistantMessage.role,
      content: assistantMessage.content,
      createdAt: assistantMessage.createdAt,
    },
    routingDecision,
    tier: llmResponse.tier,
    ui: toMessageUi(llmResponse),
  }
}

function shouldIsolateExistingConversation(
  conversation: ChatbotConversation,
  userId: string | undefined,
): boolean {
  if (!conversation.context.userId) return false
  return conversation.context.userId !== userId
}

function createDefaultChatbotLlmOrchestrator(): ChatbotLlmTierOrchestrator {
  const clients: ChatbotLlmClient[] = [
    createTier1ChromeNotionAiClient({ preferredModel: tier1ObservedNotionAiModel }),
    createTier2OllamaDeepSeekClient(),
    createTier4FormFallbackClient(),
  ]
  return createChatbotLlmTierOrchestrator({
    clients,
    onTierAttempt: createLocalChatbotTierAttemptLogger(),
  })
}

function buildChatbotSystemPrompt(
  userContext?: UserChatbotContext | null,
  userContextFormatter: typeof formatUserChatbotContextForPrompt = formatUserChatbotContextForPrompt,
): string {
  const lines = [
    buildChatbotStaticPolicyPrompt(),
    "回答範囲は新規案件の調整、要件整理、予約導線に限定し、技術指導、作品レビュー、標準外要望は担当者確認へ誘導します。",
    "不明なことを推測で断定せず、未確認事項として質問します。",
    "2026年10月より前は作業場所のデフォルト提案をせず、クライアントの希望を先に確認します。",
    "呼称は中立に保ち、他顧客の情報を参照または推測しません。",
  ]

  if (userContext) {
    lines.push(userContextFormatter(userContext))
  }

  return lines.join("\n")
}

function buildJobContext(
  input: Partial<JobContext> | undefined,
  conversation: ChatbotConversation,
): JobContext {
  const stored = conversation.context.jobContext ?? {}
  return {
    finalMedium: "other",
    workSite: "remote-grading",
    documentaryAttachment: { kind: "none" },
    ...stored,
    ...input,
  }
}

function buildConversationState(
  input: Partial<ConversationState> | undefined,
  conversation: ChatbotConversation,
  userMessage: ChatbotMessage,
): ConversationState {
  const userTurnCount =
    conversation.messages.filter((message) => message.role === "user").length +
    (userMessage.role === "user" ? 1 : 0)

  const topicGate = classifyChatbotTopic(userMessage.content)

  return {
    hasFinalMedium: false,
    hasJobKind: false,
    hasAdditionalWork: false,
    hasDocumentaryAttachments: false,
    hasWorkSite: false,
    hasReferenceUrls: false,
    hasContactEmail: false,
    hasDesiredSchedule: false,
    hasCustomerIdentity: Boolean(input?.hasCustomerIdentity ?? input?.customerName ?? input?.companyName),
    turnCount: input?.turnCount ?? userTurnCount,
    ...input,
    ...topicGate,
  }
}

function toMessageUi(response: ChatbotLlmResponse): ChatbotMessageUi {
  if (response.tier === "tier-4-form-fallback") return { kind: "tier4-inquiry-form" }

  const routingDecision = response.proposedRoutingDecision
  if (!routingDecision) return { kind: "none" }

  if (routingDecision.kind === "continue" && routingDecision.presentChoices) {
    return { kind: "choice-panel", choiceSet: routingDecision.presentChoices }
  }

  if (routingDecision.kind === "to-booking-inline") {
    if (routingDecision.suggestedSlots.length === 0) return { kind: "none" }
    return {
      kind: "booking-card",
      suggestedSlots: routingDecision.suggestedSlots,
      jobContext: routingDecision.jobContext,
    }
  }

  if (routingDecision.kind === "to-direct-contact") {
    return {
      kind: "direct-contact-card",
      reason: routingDecision.reason,
      suggestedMessage: routingDecision.suggestedMessage,
    }
  }

  return { kind: "none" }
}
