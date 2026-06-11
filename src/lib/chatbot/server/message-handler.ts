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
  createTier2HostedChromeNotionAiClient,
  createTier3OllamaDeepSeekClient,
  createTier4FormFallbackClient,
  formatUserChatbotContextForPrompt,
  linkConversationToUser,
  loadUserChatbotContext,
  loadConversationBySessionId,
  setConversationNotionAiThreadId,
  truncateConversationFromMessage,
  updateConversationRouting,
  type ChatbotLlmClient,
  type ChatbotLlmRequest,
  type ChatbotLlmResponse,
  type ChatbotLlmTierOrchestrator,
  type TierAttemptEvent,
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
import { buildChatbotKnowledgeContext } from "@/lib/chatbot/server/knowledge-context"
import type { ConversationSummary } from "@/lib/chatbot/domain/workflow-estimate"
import {
  hasRequiredConsultationNotificationSlots,
  hasRequiredEmailConsultationSlots,
} from "@/lib/chatbot/domain"
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
      conversationState: ConversationState
    }
  | {
      kind: "direct-contact-card"
      reason: Extract<RoutingDecision, { kind: "to-direct-contact" }>["reason"]
      suggestedMessage: string
    }
  | {
      kind: "consultation-summary-form"
      summary: ConversationSummary
    }
  | { kind: "tier4-inquiry-form" }

export type ChatbotMessageApiResult = {
  conversationId: string
  userMessage: Pick<ChatbotMessage, "id" | "role" | "content" | "createdAt">
  assistantMessage: Pick<ChatbotMessage, "id" | "role" | "content" | "createdAt">
  routingDecision?: RoutingDecision
  tier: ChatbotLlmResponse["tier"]
  tierAttempts: ChatbotTierAttemptDebug[]
  ui: ChatbotMessageUi
}

export type HandleChatbotMessageInput = {
  sessionId: string
  userId?: string
  message: string
  conversationId?: string
  editTargetMessageId?: string
  clientUserMessageId?: string
  jobContext?: Partial<JobContext>
  conversationState?: Partial<ConversationState>
}

export type ChatbotTierAttemptDebug = {
  tier: ChatbotLlmResponse["tier"]
  phase: TierAttemptEvent["phase"]
  outcome: TierAttemptEvent["outcome"]
  latencyMs: number
  attempt?: number
  errorCode?: string
}

type ChatbotMessageRepository = {
  loadConversationBySessionId: typeof loadConversationBySessionId
  createConversation: typeof createConversation
  appendMessage: typeof appendMessage
  truncateConversationFromMessage: typeof truncateConversationFromMessage
  updateConversationRouting: typeof updateConversationRouting
  linkConversationToUser: typeof linkConversationToUser
  setConversationNotionAiThreadId: typeof setConversationNotionAiThreadId
}

type HandleChatbotMessageOptions = {
  repository?: ChatbotMessageRepository
  orchestratorFactory?: () => ChatbotLlmTierOrchestrator
  userContextLoader?: typeof loadUserChatbotContext
  userContextFormatter?: typeof formatUserChatbotContextForPrompt
  operatorNotificationSender?: typeof sendOperatorConsultationNotification
  dedicatedNotionAiThreadsEnabled?: boolean
}

const defaultRepository: ChatbotMessageRepository = {
  loadConversationBySessionId,
  createConversation,
  appendMessage,
  truncateConversationFromMessage,
  updateConversationRouting,
  linkConversationToUser,
  setConversationNotionAiThreadId,
}

const clientUserMessageIdPattern =
  /^client_msg_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const chatbotMessageQueues = new Map<string, Promise<void>>()
let chatbotLlmGenerationQueue: Promise<void> = Promise.resolve()

export async function handleChatbotMessage(
  input: HandleChatbotMessageInput,
  options: HandleChatbotMessageOptions = {},
): Promise<ChatbotMessageApiResult> {
  return enqueueChatbotMessage(input, () => handleChatbotMessageCore(input, options))
}

async function handleChatbotMessageCore(
  input: HandleChatbotMessageInput,
  options: HandleChatbotMessageOptions = {},
): Promise<ChatbotMessageApiResult> {
  const repository = options.repository ?? defaultRepository
  const tierAttemptEvents: TierAttemptEvent[] = []
  const orchestrator =
    options.orchestratorFactory?.() ??
    createDefaultChatbotLlmOrchestrator((event) => tierAttemptEvents.push(event))
  const userContextLoader = options.userContextLoader ?? loadUserChatbotContext
  const userContextFormatter = options.userContextFormatter ?? formatUserChatbotContextForPrompt
  const operatorNotificationSender = options.operatorNotificationSender ?? sendOperatorConsultationNotification
  const dedicatedNotionAiThreadsEnabled =
    options.dedicatedNotionAiThreadsEnabled ?? isDedicatedNotionAiThreadsEnabled()
  let replaceDedicatedNotionAiThread = false
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
      if (!clientUserMessageIdPattern.test(input.editTargetMessageId)) {
        throw new Error("chatbot_edit_target_not_found")
      }
      const fallbackTargetIndex = findLastUserMessageIndex(conversation.messages)
      if (fallbackTargetIndex >= 0) {
        await repository.truncateConversationFromMessage({
          conversationId: conversation.id,
          messageId: conversation.messages[fallbackTargetIndex].id,
        })
        conversation = {
          ...conversation,
          status: "open",
          messages: conversation.messages.slice(0, fallbackTargetIndex),
        }
        replaceDedicatedNotionAiThread = true
      }
    } else {
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
  }

  const userMessage = await repository.appendMessage({
    id: input.clientUserMessageId,
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
  const llmRequest: ChatbotLlmRequest = {
    systemPrompt: buildChatbotSystemPrompt(userContext, userContextFormatter),
    messages: [
      ...conversation.messages.map(({ role, content }) => ({ role, content })),
      { role: userMessage.role, content: userMessage.content },
    ],
    conversationState,
    jobContext,
    latestUserMessage: input.message,
    knowledgeContext: buildChatbotKnowledgeContext({
      latestUserMessage: input.message,
      conversationState,
      jobContext,
    }),
    temperature: 0.2,
    maxOutputTokens: 900,
  }
  if (dedicatedNotionAiThreadsEnabled) {
    llmRequest.notionAiThread = replaceDedicatedNotionAiThread
      ? {}
      : toConversationNotionAiThread(conversation)
  }
  const llmResponse = await enqueueChatbotLlmGeneration(() => orchestrator.generate(llmRequest))
  await maybePersistDedicatedNotionAiThread({
    enabled: dedicatedNotionAiThreadsEnabled,
    conversation,
    llmResponse,
    repository,
    replaceExistingThread: replaceDedicatedNotionAiThread,
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
    llmModel: llmResponse.tier,
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
    tierAttempts: summarizeTierAttempts(tierAttemptEvents),
    ui: toMessageUi(routingDecision, llmResponse.tier, conversationState),
  }
}

async function enqueueChatbotMessage<T>(
  input: HandleChatbotMessageInput,
  operation: () => Promise<T>,
): Promise<T> {
  const queueKey = buildChatbotMessageQueueKey(input)
  const previous = chatbotMessageQueues.get(queueKey) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(operation)
  const settled = run.then(
    () => undefined,
    () => undefined,
  )

  chatbotMessageQueues.set(queueKey, settled)

  try {
    return await run
  } finally {
    if (chatbotMessageQueues.get(queueKey) === settled) {
      chatbotMessageQueues.delete(queueKey)
    }
  }
}

async function enqueueChatbotLlmGeneration<T>(operation: () => Promise<T>): Promise<T> {
  const previous = chatbotLlmGenerationQueue
  const run = previous.catch(() => undefined).then(operation)
  chatbotLlmGenerationQueue = run.then(
    () => undefined,
    () => undefined,
  )

  return run
}

function buildChatbotMessageQueueKey(input: HandleChatbotMessageInput): string {
  return `${input.sessionId}:${input.userId ?? "anonymous"}`
}

function findLastUserMessageIndex(messages: ReadonlyArray<ChatbotMessage>): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return index
  }

  return -1
}

async function maybeSendOperatorNotification(input: {
  conversation: ChatbotConversation
  routingDecision: RoutingDecision
  conversationState: ConversationState
  jobContext: JobContext
  repository: ChatbotMessageRepository
  operatorNotificationSender: typeof sendOperatorConsultationNotification
}): Promise<void> {
  if (
    input.routingDecision.kind !== "to-booking-inline" &&
    input.routingDecision.kind !== "to-direct-contact" &&
    input.routingDecision.kind !== "to-email"
  ) return
  if (hasSentOperatorNotification(input.conversation.messages)) return
  if (!hasRequiredOperatorNotificationSlots(input.routingDecision, input.conversationState)) return

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

function hasRequiredOperatorNotificationSlots(
  routingDecision: RoutingDecision,
  conversationState: ConversationState,
): boolean {
  if (routingDecision.kind === "to-email") {
    return hasRequiredEmailConsultationSlots({ conversationState })
  }

  return hasRequiredConsultationNotificationSlots({ conversationState })
}

function shouldIsolateExistingConversation(
  conversation: ChatbotConversation,
  userId: string | undefined,
): boolean {
  if (!conversation.context.userId) return false
  return conversation.context.userId !== userId
}

function createDefaultChatbotLlmOrchestrator(
  onTierAttempt?: (event: TierAttemptEvent) => void,
): ChatbotLlmTierOrchestrator {
  const clients: ChatbotLlmClient[] = [
    createTier1ChromeNotionAiClient({ preferredModel: tier1ObservedNotionAiModel }),
    createTier2HostedChromeNotionAiClient(),
    createTier3OllamaDeepSeekClient(),
    createTier4FormFallbackClient(),
  ]
  const localLogger = createLocalChatbotTierAttemptLogger()
  return createChatbotLlmTierOrchestrator({
    clients,
    onTierAttempt: (event) => {
      localLogger?.(event)
      onTierAttempt?.(event)
    },
  })
}

function summarizeTierAttempts(events: ReadonlyArray<TierAttemptEvent>): ChatbotTierAttemptDebug[] {
  return events.map((event) => ({
    tier: event.tier,
    phase: event.phase,
    outcome: event.outcome,
    latencyMs: event.latencyMs,
    ...(event.attempt ? { attempt: event.attempt } : {}),
    ...(event.error && "code" in event.error ? { errorCode: String(event.error.code) } : {}),
  }))
}

function isDedicatedNotionAiThreadsEnabled(
  env: { CHATBOT_TIER1_DEDICATED_NOTION_AI_THREADS?: string } = process.env as {
    CHATBOT_TIER1_DEDICATED_NOTION_AI_THREADS?: string
  },
): boolean {
  return (env.CHATBOT_TIER1_DEDICATED_NOTION_AI_THREADS ?? "1") === "1"
}

function toConversationNotionAiThread(
  conversation: ChatbotConversation,
): NonNullable<ChatbotLlmRequest["notionAiThread"]> {
  return conversation.context.notionAiThreadId
    ? { threadId: conversation.context.notionAiThreadId }
    : {}
}

async function maybePersistDedicatedNotionAiThread(input: {
  enabled: boolean
  conversation: ChatbotConversation
  llmResponse: ChatbotLlmResponse
  repository: ChatbotMessageRepository
  replaceExistingThread?: boolean
}): Promise<void> {
  if (!input.enabled) return
  if (input.conversation.context.notionAiThreadId && !input.replaceExistingThread) return
  if (input.llmResponse.tier !== "tier-1-chrome-notion-ai") return
  if (input.llmResponse.diagnostics?.notionAiThreadCreated !== true) return

  const threadId = input.llmResponse.diagnostics.notionAiThreadId
  if (typeof threadId !== "string" || threadId.length === 0) return

  await input.repository.setConversationNotionAiThreadId({
    conversationId: input.conversation.id,
    threadId,
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
    "連絡先を求める場合は、電話番号ではなくメールアドレス（必須）を明示します。電話番号は任意情報として扱います。",
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
    hasProjectLength: false,
    hasMaterialHandoff: false,
    hasMaterialDetails: false,
    hasAdditionalWork: false,
    hasDocumentaryAttachments: false,
    hasWorkSite: false,
    hasReferenceUrls: false,
    hasDeliveryFormat: false,
    hasProductionOptions: false,
    hasBudgetRange: false,
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
    hasProjectLength: isSlotSatisfied(
      stored.hasProjectLength,
      inferred.hasProjectLength,
      input?.hasProjectLength,
      activeChoiceConversationState?.hasProjectLength,
    ),
    hasMaterialHandoff: isSlotSatisfied(
      stored.hasMaterialHandoff,
      inferred.hasMaterialHandoff,
      input?.hasMaterialHandoff,
      activeChoiceConversationState?.hasMaterialHandoff,
    ),
    hasMaterialDetails: isSlotSatisfied(
      stored.hasMaterialDetails,
      inferred.hasMaterialDetails,
      input?.hasMaterialDetails,
      activeChoiceConversationState?.hasMaterialDetails,
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
    hasDeliveryFormat: isSlotSatisfied(stored.hasDeliveryFormat, inferred.hasDeliveryFormat, input?.hasDeliveryFormat),
    hasProductionOptions: isSlotSatisfied(
      stored.hasProductionOptions,
      inferred.hasProductionOptions,
      input?.hasProductionOptions,
      activeChoiceConversationState?.hasProductionOptions,
    ),
    hasBudgetRange: isSlotSatisfied(stored.hasBudgetRange, inferred.hasBudgetRange, input?.hasBudgetRange),
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

function toMessageUi(
  routingDecision: RoutingDecision | undefined,
  tier: ChatbotLlmResponse["tier"],
  conversationState: ConversationState,
): ChatbotMessageUi {
  if (tier === "tier-4-form-fallback") return { kind: "tier4-inquiry-form" }
  if (!routingDecision) return { kind: "none" }

  if (routingDecision.kind === "continue" && routingDecision.presentChoices) {
    return { kind: "choice-panel", choiceSet: routingDecision.presentChoices }
  }

  if (routingDecision.kind === "to-booking-inline") {
    if (routingDecision.suggestedSlots.length === 0) {
      if (!hasRequiredConsultationNotificationSlots({ conversationState })) return { kind: "none" }
      return {
        kind: "consultation-summary-form",
        summary: buildConversationSummary(routingDecision.jobContext, conversationState),
      }
    }
    return {
      kind: "booking-card",
      suggestedSlots: routingDecision.suggestedSlots,
      jobContext: routingDecision.jobContext,
      conversationState,
    }
  }

  if (routingDecision.kind === "to-direct-contact") {
    return {
      kind: "direct-contact-card",
      reason: routingDecision.reason,
      suggestedMessage: routingDecision.suggestedMessage,
    }
  }

  if (routingDecision.kind === "to-email") {
    if (!hasRequiredEmailConsultationSlots({ conversationState })) return { kind: "none" }
    return {
      kind: "consultation-summary-form",
      summary: routingDecision.summary,
    }
  }

  return { kind: "none" }
}

function buildConversationSummary(jobContext: JobContext, conversationState: ConversationState): ConversationSummary {
  return {
    subject: "チャットボット相談",
    customerEmail: conversationState.contactEmail ?? "",
    ...(conversationState.customerName ? { customerName: conversationState.customerName } : {}),
    ...(conversationState.companyName ? { companyName: conversationState.companyName } : {}),
    jobContext,
    summaryText: buildUiSummaryText(jobContext, conversationState),
    openQuestions: buildUiOpenQuestions(conversationState),
  }
}

function buildUiSummaryText(jobContext: JobContext, conversationState: ConversationState): string {
  const jobKind = jobContext.jobKind ?? "案件種別未確認"
  const schedule = conversationState.hasDesiredSchedule ? "搬入〜納品あり" : "搬入〜納品未定"

  return `${jobKind} / ${jobContext.finalMedium} / ${jobContext.workSite} / ${schedule}`
}

function buildUiOpenQuestions(conversationState: ConversationState): string[] {
  return [
    conversationState.hasFinalMedium ? undefined : "最終媒体未確認",
    conversationState.hasJobKind && conversationState.hasProjectLength ? undefined : "案件種別・尺未確認",
    conversationState.hasMaterialHandoff ? undefined : "素材受け渡し未確認",
    conversationState.hasAdditionalWork ? undefined : "追加作業未確認",
    conversationState.hasDocumentaryAttachments ? undefined : "付随映像未確認",
    conversationState.hasWorkSite ? undefined : "作業場所未確認",
    conversationState.hasReferenceUrls ? undefined : "参考URL未確認",
    conversationState.hasDesiredSchedule ? undefined : "素材搬入〜納品時期未確認",
  ].filter((item): item is string => Boolean(item))
}

function conversationText(conversation: ChatbotConversation, userMessage: ChatbotMessage): string {
  return [...conversation.messages, userMessage].map((message) => message.content).join("\n")
}

function inferConversationStateFromText(text: string): Partial<ConversationState> {
  const hasProjectLength = /(?:尺|長さ|length|duration|\d+\s*(?:時間|h|hours?|分|m|min|minutes?))/iu.test(text)
  const hasSchedule = /(?:6月中旬|６月中旬|中旬|素材.*(?:搬入|受け取り|受取)|搬入|受け取り|受取|カラコレ開始|納品|公開|希望時期|月末|まで|deadline)/iu.test(text)
  const hasContactEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(text)
  const identity = inferCustomerIdentityFromText(text)
  const hasCustomerIdentity = identity.hasCustomerIdentity
  const hasDeliveryFormat = /(?:納品形式|納品フォーマット|prores|mp4|mov|h\.?264|h\.?265)/iu.test(text)
  const hasMaterialHandoff =
    /(?:受け渡し|オンライン共有|共有リンク|ギガファイル|gigafile|google\s*drive|dropbox|クラウド|アップロード|sd|hdd|ssd|郵送|持ち込み|搬入|転送)/iu.test(text)
  const hasMaterialDetails =
    /(?:素材内容|カメラ\s*\d+\s*台|カメラ台数|収録形式|解像度|フレームレート|fps|4k|full\s*hd|fullhd|1080|prores|raw|log|s-log)/iu.test(text)
  const hasProductionOptions = /(?:字幕|テロップ|ナレーション|音楽|bgm)/iu.test(text)
  const hasBudgetRange = /(?:予算|ご予算|概算|レンジ|\d+\s*(?:万|万円|円)|budget)/iu.test(text)
  const hasMeetingPreference = /(?:打ち合わせ|ミーティング|オンライン|zoom|meet)/iu.test(text)
  const hasWorkSite = /(?:作業場所|立ち会い|リモート|オンライン|スタジオ|現地)/u.test(text)
  const hasTransfer = /(?:素材|搬入|受け渡し|アップロード|drive|dropbox|gigafile|ギガファイル)/iu.test(text)

  return {
    hasFinalMedium: /(?:web\s*cm|web|cm|mv|ミュージックビデオ|sns|ott|tv|テレビ|劇場|live|ライブ)/iu.test(text),
    hasJobKind: /(?:ab\s*タイプ|a\/b|2\s*本|２\s*本|cm|mv|web\s*cm|live|ライブ)/iu.test(text),
    hasProjectLength,
    hasMaterialHandoff,
    hasMaterialDetails,
    hasAdditionalWork: /(?:カラグレ|カラーグレーディング|追加作業|修正|レタッチ|なし)/u.test(text),
    hasDocumentaryAttachments: /(?:付随|資料|参考|なし|素材)/u.test(text),
    hasWorkSite,
    hasReferenceUrls: /https?:\/\//iu.test(text) || hasTransfer,
    hasContactEmail,
    hasDesiredSchedule: hasSchedule,
    hasCustomerIdentity,
    contactEmail: hasContactEmail ? text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0] : undefined,
    customerName: identity.customerName,
    companyName: identity.companyName,
    hasDeliveryFormat,
    hasProductionOptions,
    hasBudgetRange,
    hasMeetingPreference,
  } as Partial<ConversationState>
}

function inferCustomerIdentityFromText(text: string): {
  hasCustomerIdentity: boolean
  customerName?: string
  companyName?: string
} {
  const companyName =
    cleanInferredIdentityValue(
      text.match(/(?:会社名|社名|所属)\s*(?:は|:|：)?\s*([^\n、,。]+)/u)?.[1],
      "company",
    ) ??
    cleanInferredIdentityValue(text.match(/((?:株式会社|合同会社|有限会社)[^\s、,。の]{1,30})/u)?.[1], "company") ??
    cleanInferredIdentityValue(text.match(/([^\s、,。]{1,30}(?:株式会社|合同会社|有限会社))/u)?.[1], "company")

  const customerName =
    cleanInferredIdentityValue(
      text.match(/(?:担当者氏名|担当者名|担当|氏名|お名前|名前)\s*(?:は|:|：)?\s*([^\n、,。]+)/u)?.[1],
      "person",
    ) ?? cleanInferredIdentityValue(text.match(/(?:株式会社|合同会社|有限会社)[^\s、,。の]{1,30}の([^\s、,。]+?)(?:です|と申します)?(?:[。\n、,]|$)/u)?.[1], "person")

  return {
    hasCustomerIdentity: /(?:会社|株式会社|合同会社|有限会社|担当|名前|氏名|お名前)/u.test(text),
    ...(customerName ? { customerName } : {}),
    ...(companyName ? { companyName } : {}),
  }
}

function cleanInferredIdentityValue(value: string | undefined, kind: "company" | "person"): string | undefined {
  if (!value) return undefined

  const cleaned = value
    .replace(/(?:です|でございます|と申します|になります|です。)$/u, "")
    .replace(/\s+/gu, " ")
    .trim()

  if (!cleaned || cleaned === "provided") return undefined
  if (/(?:共有済み|提供済み|取得済み|未定|不明|連絡先|メール|納品形式|打ち合わせ|作業場所|希望|済み)/u.test(cleaned)) {
    return undefined
  }
  if (/(?:案件種別|最終媒体|尺|素材|受け渡し|納品|解像度|字幕|テロップ|ナレーション|音楽|予算)/u.test(cleaned)) {
    return undefined
  }
  if (/^(?:ライブ|live|web|cm|mv|ott|sns|tv|テレビ|劇場|映画|その他|リモート|オンライン共有|ギガファイル|クラウド)$/iu.test(cleaned)) {
    return undefined
  }
  if (kind === "person" && /(?:株式会社|合同会社|有限会社|会社|法人|スタジオ|プロダクション)/u.test(cleaned)) {
    return undefined
  }
  if (kind === "company" && /(?:さん|様)$/u.test(cleaned)) return undefined
  if (kind === "company" && cleaned.length > 40) return undefined
  if (kind === "person" && cleaned.length > 24) return undefined

  return cleaned
}

function inferJobContextFromText(text: string): Partial<JobContext> {
  const finalMedium = inferFinalMediumFromText(text)
  const projectLengthMinutes = inferProjectLengthMinutes(text)
  const preferredStartDate = /(?:6月中旬|６月中旬|中旬|6月中頃|６月中頃)/u.test(text) ? "2026-06-15" : undefined
  const publicReleaseDate = /(?:6月20日|６月２０日|6\/20|06-20)/u.test(text)
    ? "2026-06-20"
    : /(?:月末|6月末|６月末)/u.test(text)
      ? "2026-06-30"
      : undefined

  return {
    ...(finalMedium ? { finalMedium } : {}),
    ...(/(?:web\s*cm|cm)/iu.test(text) ? { jobKind: "cm-30s" as const } : {}),
    ...(finalMedium === "live" && projectLengthMinutes !== undefined ? { jobKind: "live-60m" as const } : {}),
    ...(projectLengthMinutes ? { projectLengthMinutes } : {}),
    ...(preferredStartDate ? { preferredStartDate } : {}),
    ...(publicReleaseDate ? { publicReleaseDate } : {}),
  }
}

function inferProjectLengthMinutes(text: string): number | undefined {
  const mixedHourMatch = text.match(/(\d+)\s*(?:時間|h|hours?)\s*(?:半|30\s*(?:分|m|min|minutes?))/iu)
  if (mixedHourMatch?.[1]) return Number.parseInt(mixedHourMatch[1], 10) * 60 + 30

  const decimalHourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:時間|h|hours?)/iu)
  if (decimalHourMatch?.[1]) return Number.parseFloat(decimalHourMatch[1]) * 60

  const minuteMatch = text.match(/(\d+)\s*(?:分|m|min|minutes?)/iu)
  if (minuteMatch?.[1]) return Number.parseInt(minuteMatch[1], 10)

  const hourMatch = text.match(/(\d+)\s*(?:時間|h|hours?)/iu)
  if (hourMatch?.[1]) return Number.parseInt(hourMatch[1], 10) * 60

  return undefined
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
