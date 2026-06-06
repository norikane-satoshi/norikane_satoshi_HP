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
  truncateConversationFromMessage,
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
import {
  applyActiveChoiceAnswer,
  isSatisfiedChoicePanel,
} from "@/lib/chatbot/server/choice-panel-state"
import { classifyChatbotTopic } from "@/lib/chatbot/server/topic-gate"
import { hasRequiredConsultationNotificationSlots } from "@/lib/chatbot/domain"
import {
  OPERATOR_NOTIFICATION_SENT_MARKER,
  hasSentOperatorNotification,
  sendOperatorConsultationNotification,
} from "@/lib/chatbot/server/operator-notification"

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
  userMessage: Pick<ChatbotMessage, "id" | "role" | "content" | "createdAt">
  assistantMessage: Pick<ChatbotMessage, "id" | "role" | "content" | "createdAt">
  routingDecision?: RoutingDecision
  tier: ChatbotLlmResponse["tier"]
  ui: ChatbotMessageUi
}

export type HandleChatbotMessageInput = {
  sessionId: string
  userId?: string
  message: string
  conversationId?: string
  editTargetMessageId?: string
  jobContext?: Partial<JobContext>
  conversationState?: Partial<ConversationState>
}

type ChatbotMessageRepository = {
  loadConversationBySessionId: typeof loadConversationBySessionId
  createConversation: typeof createConversation
  appendMessage: typeof appendMessage
  truncateConversationFromMessage: typeof truncateConversationFromMessage
  updateConversationRouting: typeof updateConversationRouting
  linkConversationToUser: typeof linkConversationToUser
}

type HandleChatbotMessageOptions = {
  repository?: ChatbotMessageRepository
  orchestratorFactory?: () => ChatbotLlmTierOrchestrator
  userContextLoader?: typeof loadUserChatbotContext
  userContextFormatter?: typeof formatUserChatbotContextForPrompt
  operatorNotificationSender?: typeof sendOperatorConsultationNotification
}

const defaultRepository: ChatbotMessageRepository = {
  loadConversationBySessionId,
  createConversation,
  appendMessage,
  truncateConversationFromMessage,
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
  const operatorNotificationSender = options.operatorNotificationSender ?? sendOperatorConsultationNotification
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

  if (input.editTargetMessageId) {
    const targetIndex = conversation.messages.findIndex((message) => message.id === input.editTargetMessageId)
    if (targetIndex === -1) {
      throw new Error("chatbot_edit_target_not_found")
    }
    await repository.truncateConversationFromMessage({
      conversationId: conversation.id,
      messageId: input.editTargetMessageId,
    })
    conversation = {
      ...conversation,
      status: "open",
      context: {
        sessionId: conversation.context.sessionId,
        ...(conversation.context.userId ? { userId: conversation.context.userId } : {}),
        ...(conversation.context.customerEmail ? { customerEmail: conversation.context.customerEmail } : {}),
      },
      messages: conversation.messages.slice(0, targetIndex),
    }
  }

  const userMessage = await repository.appendMessage({
    conversationId: conversation.id,
    role: "user",
    content: input.message,
  })
  const activeChoiceAnswer = applyActiveChoiceAnswer({
    activeChoices: conversation.context.activeChoices,
    message: input.message,
  })
  const userContext = input.userId
    ? await userContextLoader({
        userId: input.userId,
        currentConversationId: conversation.id,
      })
    : null
  const jobContext = buildJobContext(input.jobContext, conversation, userMessage, activeChoiceAnswer?.jobContext)
  const conversationState = buildConversationState(
    input.conversationState,
    conversation,
    userMessage,
    activeChoiceAnswer?.conversationState,
  )
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
  const routingDecision = chooseRoutingDecision({
    deterministicRoutingDecision,
    proposedRoutingDecision: llmResponse.proposedRoutingDecision,
    conversationState,
  })
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
      currentQuestion: routingDecision.kind === "continue" ? routingDecision.nextQuestion : null,
      activeChoices: routingDecision.kind === "continue" ? routingDecision.presentChoices ?? null : null,
      conversationState,
      jobContext,
    })
    await maybeSendOperatorNotification({
      conversation,
      routingDecision,
      conversationState,
      jobContext,
      repository,
      operatorNotificationSender,
    })
  }

  return {
    conversationId: conversation.id,
    userMessage: {
      id: userMessage.id,
      role: userMessage.role,
      content: userMessage.content,
      createdAt: userMessage.createdAt,
    },
    assistantMessage: {
      id: assistantMessage.id,
      role: assistantMessage.role,
      content: assistantMessage.content,
      createdAt: assistantMessage.createdAt,
    },
    routingDecision,
    tier: llmResponse.tier,
    ui: toMessageUi(routingDecision, llmResponse.tier),
  }
}

async function maybeSendOperatorNotification(input: {
  conversation: ChatbotConversation
  routingDecision: RoutingDecision
  conversationState: ConversationState
  jobContext: JobContext
  repository: ChatbotMessageRepository
  operatorNotificationSender: typeof sendOperatorConsultationNotification
}): Promise<void> {
  if (input.routingDecision.kind !== "to-booking-inline" && input.routingDecision.kind !== "to-direct-contact") return
  if (hasSentOperatorNotification(input.conversation.messages)) return
  if (!hasRequiredConsultationNotificationSlots({ conversationState: input.conversationState })) return

  const result = await input.operatorNotificationSender({
    trigger: "chat-completed",
    jobContext: input.jobContext,
    conversationState: input.conversationState,
  })

  if (result.status !== "sent") return

  await input.repository.appendMessage({
    conversationId: input.conversation.id,
    role: "system",
    content: `${OPERATOR_NOTIFICATION_SENT_MARKER} ${new Date().toISOString()}`,
  })
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
    "回答範囲は新規案件の調整、要件整理、予約導線に限定し、技術指導、作品レビュー、標準外要望はのりかね本人の確認へ誘導します。",
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
  userMessage: ChatbotMessage,
  activeChoiceJobContext: Partial<JobContext> | undefined,
): JobContext {
  const stored = conversation.context.jobContext ?? {}
  const inferred = inferJobContextFromText(conversationText(conversation, userMessage))
  return {
    finalMedium: "other",
    workSite: "remote-grading",
    documentaryAttachment: { kind: "none" },
    ...inferred,
    ...stored,
    ...input,
    ...activeChoiceJobContext,
  }
}

function buildConversationState(
  input: Partial<ConversationState> | undefined,
  conversation: ChatbotConversation,
  userMessage: ChatbotMessage,
  activeChoiceConversationState: Partial<ConversationState> | undefined,
): ConversationState {
  const userTurnCount =
    conversation.messages.filter((message) => message.role === "user").length +
    (userMessage.role === "user" ? 1 : 0)

  const topicGate = classifyChatbotTopic(userMessage.content)
  const stored = conversation.context.conversationState ?? {}
  const inferred = inferConversationStateFromText(conversationText(conversation, userMessage))
  const merged = {
    hasFinalMedium: false,
    hasJobKind: false,
    hasAdditionalWork: false,
    hasDocumentaryAttachments: false,
    hasWorkSite: false,
    hasReferenceUrls: false,
    hasContactEmail: false,
    hasDesiredSchedule: false,
    ...stored,
    ...inferred,
    ...input,
    ...activeChoiceConversationState,
    ...topicGate,
  }

  return {
    ...merged,
    hasFinalMedium: isSlotSatisfied(
      stored.hasFinalMedium,
      inferred.hasFinalMedium,
      input?.hasFinalMedium,
      activeChoiceConversationState?.hasFinalMedium,
    ),
    hasJobKind: isSlotSatisfied(
      stored.hasJobKind,
      inferred.hasJobKind,
      input?.hasJobKind,
      activeChoiceConversationState?.hasJobKind,
    ),
    hasAdditionalWork: isSlotSatisfied(
      stored.hasAdditionalWork,
      inferred.hasAdditionalWork,
      input?.hasAdditionalWork,
      activeChoiceConversationState?.hasAdditionalWork,
    ),
    hasDocumentaryAttachments: isSlotSatisfied(
      stored.hasDocumentaryAttachments,
      inferred.hasDocumentaryAttachments,
      input?.hasDocumentaryAttachments,
      activeChoiceConversationState?.hasDocumentaryAttachments,
    ),
    hasWorkSite: isSlotSatisfied(
      stored.hasWorkSite,
      inferred.hasWorkSite,
      input?.hasWorkSite,
      activeChoiceConversationState?.hasWorkSite,
    ),
    hasReferenceUrls: isSlotSatisfied(stored.hasReferenceUrls, inferred.hasReferenceUrls, input?.hasReferenceUrls),
    hasContactEmail: isSlotSatisfied(stored.hasContactEmail, inferred.hasContactEmail, input?.hasContactEmail),
    hasDesiredSchedule: isSlotSatisfied(stored.hasDesiredSchedule, inferred.hasDesiredSchedule, input?.hasDesiredSchedule),
    hasCustomerIdentity: isSlotSatisfied(
      stored.hasCustomerIdentity,
      input?.hasCustomerIdentity,
      Boolean(input?.customerName ?? input?.companyName),
      inferred.hasCustomerIdentity,
    ),
    turnCount: Math.max(stored.turnCount ?? 0, input?.turnCount ?? 0, userTurnCount),
  }
}

function chooseRoutingDecision(input: {
  deterministicRoutingDecision: RoutingDecision
  proposedRoutingDecision?: RoutingDecision
  conversationState: ConversationState
}): RoutingDecision {
  if (input.deterministicRoutingDecision.kind !== "continue") return input.deterministicRoutingDecision

  if (
    input.deterministicRoutingDecision.kind === "continue" &&
    input.deterministicRoutingDecision.presentChoices
  ) {
    return input.deterministicRoutingDecision
  }

  if (input.proposedRoutingDecision?.kind !== "continue") return input.deterministicRoutingDecision

  if (
    isSatisfiedChoicePanel(input.proposedRoutingDecision.presentChoices, input.conversationState)
  ) {
    return input.deterministicRoutingDecision
  }

  return input.proposedRoutingDecision
}

function isSlotSatisfied(...values: Array<boolean | undefined>): boolean {
  return values.some(Boolean)
}

function toMessageUi(routingDecision: RoutingDecision | undefined, tier: ChatbotLlmResponse["tier"]): ChatbotMessageUi {
  if (tier === "tier-4-form-fallback") return { kind: "tier4-inquiry-form" }
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

function conversationText(conversation: ChatbotConversation, userMessage: ChatbotMessage): string {
  return [...conversation.messages, userMessage].map((message) => message.content).join("\n")
}

function inferConversationStateFromText(text: string): Partial<ConversationState> {
  const hasProjectLength = /(?:尺|長さ|length|duration|4\s*分|４\s*分|\d+\s*min)/iu.test(text)
  const hasSchedule = /(?:6月中旬|６月中旬|中旬|納品|公開|希望時期|作業したい|まで|deadline)/iu.test(text)
  const hasContactEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(text)
  const hasCustomerIdentity = /(?:会社|株式会社|合同会社|担当|名前|氏名|お名前)/u.test(text)
  const hasDeliveryFormat = /(?:納品形式|納品フォーマット|prores|mp4|mov|h\.?264|h\.?265)/iu.test(text)
  const hasMeetingPreference = /(?:打ち合わせ|ミーティング|オンライン|zoom|meet)/iu.test(text)
  const hasWorkSite = /(?:作業場所|立ち会い|リモート|オンライン|スタジオ|現地)/u.test(text)
  const hasTransfer = /(?:素材|搬入|受け渡し|アップロード|drive|dropbox|gigafile|ギガファイル)/iu.test(text)

  return {
    hasFinalMedium: /(?:web\s*cm|web|cm|mv|ミュージックビデオ|sns|ott|tv|テレビ|劇場|live|ライブ)/iu.test(text),
    hasJobKind: hasProjectLength || /(?:ab\s*タイプ|a\/b|2\s*本|２\s*本|cm|mv|web\s*cm)/iu.test(text),
    hasAdditionalWork: /(?:カラグレ|カラーグレーディング|追加作業|修正|レタッチ|なし)/u.test(text),
    hasDocumentaryAttachments: /(?:付随|資料|参考|なし|素材)/u.test(text),
    hasWorkSite,
    hasReferenceUrls: /https?:\/\//iu.test(text) || hasTransfer,
    hasContactEmail,
    hasDesiredSchedule: hasSchedule,
    hasCustomerIdentity,
    contactEmail: hasContactEmail ? text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0] : undefined,
    customerName: hasCustomerIdentity ? "provided" : undefined,
    companyName: hasCustomerIdentity ? "provided" : undefined,
    hasDeliveryFormat,
    hasMeetingPreference,
  } as Partial<ConversationState>
}

function inferJobContextFromText(text: string): Partial<JobContext> {
  const finalMedium = inferFinalMediumFromText(text)
  const projectLengthMinutes = /(?:4|４)\s*分/u.test(text) ? 4 : undefined
  const preferredStartDate = /(?:6月中旬|６月中旬|中旬)/u.test(text) ? "2026-06-15" : undefined
  const publicReleaseDate = /(?:6月20日|６月２０日|6\/20|06-20)/u.test(text) ? "2026-06-20" : undefined

  return {
    ...(finalMedium ? { finalMedium } : {}),
    ...(/(?:web\s*cm|cm)/iu.test(text) ? { jobKind: "cm-30s" as const } : {}),
    ...(projectLengthMinutes ? { projectLengthMinutes } : {}),
    ...(preferredStartDate ? { preferredStartDate } : {}),
    ...(publicReleaseDate ? { publicReleaseDate } : {}),
  }
}

function inferFinalMediumFromText(text: string): JobContext["finalMedium"] | undefined {
  if (/(?:live|ライブ)/iu.test(text)) return "live"
  if (/(?:ott|配信)/iu.test(text)) return "ott"
  if (/(?:劇場|cinema)/iu.test(text)) return "cinema"
  if (/(?:tv|テレビ|地上波)/iu.test(text)) return "tv-broadcast"
  if (/(?:縦型|sns|shorts|reels|tiktok)/iu.test(text)) return "vertical-sns"
  if (/(?:web\s*cm|web|cm|mv|ミュージックビデオ)/iu.test(text)) return "web"
  return undefined
}
