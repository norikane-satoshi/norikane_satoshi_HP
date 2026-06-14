import type {
  ChatbotConversation,
  ChatbotBookingPrefill,
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
  normalizeChatbotLlmResponse,
  tier1NotionAiModelFallbackChain,
} from "@/lib/chatbot/server"
import {
  applyActiveChoiceAnswer,
  isSatisfiedChoicePanel,
} from "@/lib/chatbot/server/choice-panel-state"
import { classifyChatbotTopic } from "@/lib/chatbot/server/topic-gate"
import { buildChatbotKnowledgeContext } from "@/lib/chatbot/server/knowledge-context"
import {
  runChatbotAgentLoop,
  type ChatbotAgentLoopResult,
} from "@/lib/chatbot/server/agent-loop"
import {
  appendChatbotSystemData,
  buildChatbotSystemPrompt,
} from "@/lib/chatbot/server/system-prompt"
import type { CandidateWindow, ConversationSummary, WorkflowEstimate } from "@/lib/chatbot/domain/workflow-estimate"
import {
  hasRequiredConsultationNotificationSlots,
  hasRequiredEmailConsultationSlots,
} from "@/lib/chatbot/domain"
import {
  OPERATOR_NOTIFICATION_SENT_MARKER,
  hasSentOperatorNotification,
  sendOperatorConsultationNotification,
} from "@/lib/chatbot/server/operator-notification"
import {
  findCandidateCalendar,
  type CandidateCalendarResult,
} from "@/lib/chatbot/server/availability-finder"
import {
  type ChatbotToolDispatchResult,
  type ChatbotToolExecutionContext,
} from "@/lib/chatbot/server/tool-dispatcher"
import { parseBookingPrefillJson } from "@/lib/chatbot/server/tool-json"

type CandidateWindowFinder =
  | typeof findCandidateCalendar
  | ((args: Parameters<typeof findCandidateCalendar>[0]) => Promise<CandidateWindow[]>)

type ChatbotMessageUi =
  | { kind: "none" }
  | { kind: "choice-panel"; choiceSet: NonNullable<Extract<RoutingDecision, { kind: "continue" }>["presentChoices"]> }
  | {
      kind: "booking-card"
      suggestedSlots: Extract<RoutingDecision, { kind: "to-booking-inline" }>["suggestedSlots"]
      busyDateKeys?: string[]
      jobContext: JobContext
      conversationState: ConversationState
      bookingPrefill: ChatbotBookingPrefill
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
  userEmail?: string
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
  candidateWindowFinder?: CandidateWindowFinder
  dedicatedNotionAiThreadsEnabled?: boolean
  createBookingFromApiInput?: ChatbotToolExecutionContext["createBookingFromApiInput"]
  toolShadowLogger?: (message: string) => void
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
    systemPrompt: buildChatbotSystemPrompt(userContext, userContextFormatter, {
      conversationState,
      jobContext,
    }),
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
  const deterministicRoutingDecision = decideRoutingFallback({
    jobContext,
    conversationState,
    latestUserMessage: input.message,
  })
  let routingDecision = await resolveBookingCandidates({
    routingDecision: deterministicRoutingDecision,
    candidateWindowFinder: options.candidateWindowFinder ?? findCandidateCalendar,
  })
  let llmResponse: ChatbotLlmResponse = buildRuleFallbackLlmResponse(routingDecision)
  let toolDispatchResult: ChatbotAgentLoopResult["toolDispatchResult"] | { status: "not-requested" } = {
    status: "not-requested",
  }
  let effectiveJobContext = jobContext

  if (deterministicRoutingDecision.kind !== "to-direct-contact") {
    try {
      const agentLoopResult = await runChatbotAgentLoop({
        request: llmRequest,
        orchestrator,
        generate: (request) => enqueueChatbotLlmGeneration(() => orchestrator.generate(request)),
        resolveRoutingDecision: async (response) =>
          resolveBookingCandidates({
            routingDecision: chooseRoutingDecision({
              deterministicRoutingDecision,
              proposedRoutingDecision: response.proposedRoutingDecision,
              conversationState,
            }),
            candidateWindowFinder: options.candidateWindowFinder ?? findCandidateCalendar,
          }),
        conversationState,
        jobContext,
        latestUserMessage: input.message,
        toolContext: {
          userId: input.userId,
          userEmail: input.userEmail,
          createBookingFromApiInput: options.createBookingFromApiInput,
          conversationState,
        },
        logger: options.toolShadowLogger,
      })
      llmResponse = agentLoopResult.llmResponse
      routingDecision = agentLoopResult.routingDecision
      effectiveJobContext = agentLoopResult.effectiveJobContext
      toolDispatchResult = agentLoopResult.toolDispatchResult ?? { status: "not-requested" }
      await maybePersistAgentLoopNotionAiThread({
        enabled: dedicatedNotionAiThreadsEnabled,
        conversation,
        threadId: agentLoopResult.createdNotionAiThreadId,
        repository,
        replaceExistingThread: replaceDedicatedNotionAiThread,
      })
    } catch (error) {
      ;(options.toolShadowLogger ?? console.info)(
        `[agent-loop] fallback reason=${error instanceof Error ? error.message : String(error)}`,
      )
      routingDecision = await resolveBookingCandidates({
        routingDecision: deterministicRoutingDecision,
        candidateWindowFinder: options.candidateWindowFinder ?? findCandidateCalendar,
      })
      llmResponse = buildRuleFallbackLlmResponse(routingDecision)
    }
  } else {
    ;(options.toolShadowLogger ?? console.info)("[agent-loop] skipped safety=to-direct-contact")
  }

  await maybePersistDedicatedNotionAiThread({
    enabled: dedicatedNotionAiThreadsEnabled,
    conversation,
    llmResponse,
    repository,
    replaceExistingThread: replaceDedicatedNotionAiThread,
  })
  const executedToolDispatchResult = toolDispatchResult.status === "executed" ? toolDispatchResult : null
  const toolExecutedCreateBooking = executedToolDispatchResult?.tool === "create_booking"
  const toolExecutedGetEstimate = executedToolDispatchResult?.tool === "get_estimate"
  const toolEstimate = toolExecutedGetEstimate ? workflowEstimateFromToolResult(executedToolDispatchResult.result) : null
  effectiveJobContext = toolEstimate ? { ...effectiveJobContext, workflowEstimate: toolEstimate } : effectiveJobContext
  const toolRoutingDecision = executedToolDispatchResult
    ? routingDecisionFromToolResult(executedToolDispatchResult.result)
    : null
  if (toolRoutingDecision) {
    routingDecision = toolRoutingDecision
  }
  const normalizedLlmResponse = toolExecutedCreateBooking
    ? {
        content: buildCreateBookingSuccessContent(executedToolDispatchResult),
        role: "assistant" as const,
        model: llmResponse.tier,
        finish_reason: "stop" as const,
      }
    : toolExecutedGetEstimate && toolEstimate
      ? {
          content: buildGetEstimateSuccessContent(toolEstimate),
          role: "assistant" as const,
          model: llmResponse.tier,
          finish_reason: "stop" as const,
        }
      : normalizeChatbotLlmResponse(llmResponse, { routingDecision, jobContext: effectiveJobContext })
  const bookingPrefill = toolExecutedCreateBooking
    ? {}
    : mergeBookingPrefills(
        bookingPrefillFromToolResult(executedToolDispatchResult?.result),
        await extractBookingFormPrefill({
          routingDecision,
          conversation,
          userMessage,
          conversationState,
          jobContext,
          orchestrator,
          notionAiThread: resolveExistingNotionAiThreadForJsonRead(conversation, llmResponse),
        }),
      )
  const assistantMessage = await repository.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: normalizedLlmResponse.content,
    llmModel: llmResponse.tier,
  })

  if (routingDecision && !toolExecutedCreateBooking) {
    await repository.updateConversationRouting({
      conversationId: conversation.id,
      routingDecision: routingDecision.kind,
      currentQuestion: routingDecision.kind === "continue" ? routingDecision.nextQuestion : null,
      activeChoices: routingDecision.kind === "continue" ? routingDecision.presentChoices ?? null : null,
      conversationState,
      jobContext: routingDecision.kind === "to-booking-inline" ? routingDecision.jobContext : effectiveJobContext,
    })
    await maybeSendOperatorNotification({
      conversation,
      routingDecision,
      conversationState,
      jobContext: effectiveJobContext,
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
    ui: toolExecutedCreateBooking
      ? { kind: "none" }
      : toMessageUi(routingDecision, llmResponse.tier, conversationState, bookingPrefill),
  }
}

function buildCreateBookingSuccessContent(result: Extract<ChatbotToolDispatchResult, { status: "executed" }>): string {
  const bookingGroupId = bookingGroupIdFromToolResult(result.result)
  return bookingGroupId
    ? `予約を受け付けました。予約番号: ${bookingGroupId}`
    : "予約を受け付けました。"
}

function bookingGroupIdFromToolResult(result: unknown): string | null {
  if (!result || typeof result !== "object") return null
  const body = (result as { body?: unknown }).body
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const bookingGroupId = (body as { bookingGroupId?: unknown }).bookingGroupId
  return typeof bookingGroupId === "string" && bookingGroupId.trim() ? bookingGroupId : null
}

function workflowEstimateFromToolResult(result: unknown): WorkflowEstimate | null {
  if (!result || typeof result !== "object") return null
  const workflowEstimate = (result as { workflowEstimate?: unknown }).workflowEstimate
  if (!workflowEstimate || typeof workflowEstimate !== "object") return null
  const totalMinDays = (workflowEstimate as { totalMinDays?: unknown }).totalMinDays
  const totalMaxDays = (workflowEstimate as { totalMaxDays?: unknown }).totalMaxDays
  return typeof totalMinDays === "number" && typeof totalMaxDays === "number"
    ? (workflowEstimate as WorkflowEstimate)
    : null
}

function bookingPrefillFromToolResult(result: unknown): ChatbotBookingPrefill {
  if (!result || typeof result !== "object") return {}
  const bookingPrefill = (result as { bookingPrefill?: unknown }).bookingPrefill
  if (!bookingPrefill || typeof bookingPrefill !== "object" || Array.isArray(bookingPrefill)) return {}
  return sanitizeBookingPrefillObject(bookingPrefill as Record<string, unknown>)
}

function routingDecisionFromToolResult(result: unknown): RoutingDecision | null {
  if (!result || typeof result !== "object") return null
  const routingDecision = (result as { routingDecision?: unknown }).routingDecision
  if (!routingDecision || typeof routingDecision !== "object") return null
  const kind = (routingDecision as { kind?: unknown }).kind
  if (kind !== "continue" && kind !== "to-booking-inline" && kind !== "to-email" && kind !== "to-direct-contact") {
    return null
  }
  return routingDecision as RoutingDecision
}

function buildGetEstimateSuccessContent(estimate: WorkflowEstimate): string {
  return `作業目安は${formatEstimateDays(estimate.totalMinDays)}〜${formatEstimateDays(estimate.totalMaxDays)}日です。`
}

function formatEstimateDays(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "")
}

async function extractBookingFormPrefill(input: {
  routingDecision: RoutingDecision
  conversation: ChatbotConversation
  userMessage: ChatbotMessage
  conversationState: ConversationState
  jobContext: JobContext
  orchestrator: ChatbotLlmTierOrchestrator
  notionAiThread?: ChatbotLlmRequest["notionAiThread"]
}): Promise<ChatbotBookingPrefill> {
  if (input.routingDecision.kind !== "to-booking-inline") return {}
  if (input.routingDecision.suggestedSlots.length === 0) return {}
  const deterministicPrefill = buildDeterministicBookingPrefill(input.conversationState, input.jobContext)

  try {
    const response = await enqueueChatbotLlmGeneration(() =>
      input.orchestrator.generate({
        systemPrompt: appendChatbotSystemData(
          [
            "会話全体を読み取り、予約フォーム初期値だけをJSONで返してください。",
            "返すキーは projectTitle, contactName, companyName, contactEmail, dueDate の5つだけです。",
            "会話中に明示されていない値は空文字にしてください。推測補入は禁止です。",
            "説明文、Markdown、コードフェンスは不要です。",
          ].join("\n"),
          {
            conversationState: input.conversationState,
            jobContext: input.jobContext,
          },
        ),
        messages: [...input.conversation.messages, input.userMessage].map(({ role, content }) => ({ role, content })),
        ...(input.notionAiThread ? { notionAiThread: input.notionAiThread } : {}),
        forceFullPrompt: true,
        conversationState: input.conversationState,
        jobContext: input.jobContext,
        temperature: 0,
        maxOutputTokens: 180,
      }),
    )

    return mergeBookingPrefills(deterministicPrefill, parseBookingPrefillJson(response.rawText))
  } catch {
    return deterministicPrefill
  }
}

function buildDeterministicBookingPrefill(
  conversationState: ConversationState,
  jobContext: JobContext,
): ChatbotBookingPrefill {
  return sanitizeBookingPrefillObject({
    projectTitle: conversationState.projectTitle,
    contactName: conversationState.customerName,
    companyName: conversationState.companyName,
    contactEmail: conversationState.contactEmail,
    dueDate: jobContext.publicReleaseDate,
  })
}

function sanitizeBookingPrefillObject(value: Record<string, unknown>): ChatbotBookingPrefill {
  return mergeBookingPrefills({
    projectTitle: sanitizePrefillString(value.projectTitle, 120),
    contactName: sanitizePrefillString(value.contactName, 80),
    companyName: sanitizePrefillString(value.companyName, 120),
    contactEmail: sanitizePrefillEmail(value.contactEmail),
    dueDate: sanitizePrefillString(value.dueDate, 40),
  })
}

function mergeBookingPrefills(...prefills: Array<ChatbotBookingPrefill | undefined>): ChatbotBookingPrefill {
  const merged: ChatbotBookingPrefill = {}
  for (const prefill of prefills) {
    if (!prefill) continue
    if (prefill.projectTitle) merged.projectTitle = prefill.projectTitle
    if (prefill.contactName) merged.contactName = prefill.contactName
    if (prefill.companyName) merged.companyName = prefill.companyName
    if (prefill.contactEmail) merged.contactEmail = prefill.contactEmail
    if (prefill.dueDate) merged.dueDate = prefill.dueDate
  }
  return merged
}

function sanitizePrefillString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return undefined
  if (/^(?:未入力|未定|不明|なし|null|undefined|provided)$/iu.test(trimmed)) return undefined
  return trimmed
}

function sanitizePrefillEmail(value: unknown): string | undefined {
  const trimmed = sanitizePrefillString(value, 120)
  return trimmed && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/iu.test(trimmed) ? trimmed : undefined
}

function resolveExistingNotionAiThreadForJsonRead(
  conversation: ChatbotConversation,
  llmResponse: ChatbotLlmResponse,
): ChatbotLlmRequest["notionAiThread"] {
  const createdThreadId =
    llmResponse.tier === "tier-1-chrome-notion-ai" &&
    llmResponse.diagnostics?.notionAiThreadCreated === true &&
    typeof llmResponse.diagnostics.notionAiThreadId === "string"
      ? llmResponse.diagnostics.notionAiThreadId.trim()
      : ""
  if (createdThreadId) return { threadId: createdThreadId }

  const existingThreadId = conversation.context.notionAiThreadId?.trim()
  return existingThreadId ? { threadId: existingThreadId } : undefined
}

async function resolveBookingCandidates(input: {
  routingDecision: RoutingDecision
  candidateWindowFinder: CandidateWindowFinder
}): Promise<RoutingDecision> {
  if (input.routingDecision.kind !== "to-booking-inline") return input.routingDecision
  if (input.routingDecision.suggestedSlots.length === 0) return input.routingDecision
  const workflowEstimate = input.routingDecision.jobContext.workflowEstimate
  if (!workflowEstimate) return input.routingDecision

  try {
    const calendar = normalizeCandidateCalendarResult(await input.candidateWindowFinder({
      jobContext: input.routingDecision.jobContext,
      workflowEstimate,
      candidateLimit: 31,
      busyMode: "block",
    }))
    return {
      ...input.routingDecision,
      suggestedSlots: calendar.candidates,
      busyDateKeys: calendar.busyDateKeys,
    }
  } catch {
    return input.routingDecision
  }
}

function normalizeCandidateCalendarResult(result: CandidateCalendarResult | CandidateWindow[]): CandidateCalendarResult {
  return Array.isArray(result) ? { candidates: result, busyDateKeys: [] } : result
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
    createTier1ChromeNotionAiClient({ preferredModels: tier1NotionAiModelFallbackChain }),
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

async function maybePersistAgentLoopNotionAiThread(input: {
  enabled: boolean
  conversation: ChatbotConversation
  threadId?: string
  repository: ChatbotMessageRepository
  replaceExistingThread?: boolean
}): Promise<void> {
  if (!input.enabled) return
  if (input.conversation.context.notionAiThreadId && !input.replaceExistingThread) return
  if (!input.threadId) return

  await input.repository.setConversationNotionAiThreadId({
    conversationId: input.conversation.id,
    threadId: input.threadId,
  })
}

function buildRuleFallbackLlmResponse(routingDecision: RoutingDecision): ChatbotLlmResponse {
  const rawText =
    routingDecision.kind === "continue"
      ? routingDecision.nextQuestion
      : routingDecision.kind === "to-direct-contact"
        ? routingDecision.suggestedMessage
        : ""

  return {
    rawText,
    tier: "tier-4-form-fallback",
    proposedRoutingDecision: routingDecision,
    diagnostics: { agentLoopFallback: true },
  }
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
  const pendingAdditionalWorkOtherPatch = resolvePendingAdditionalWorkOtherPatch({
    stored,
    latestUserMessage: userMessage.content,
    activeChoiceConversationState,
  })
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
    hasProjectTitle: false,
    ...stored,
    ...inferred,
    ...input,
    ...activeChoiceConversationState,
    ...topicGate,
    ...pendingAdditionalWorkOtherPatch,
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
    hasAdditionalWork: merged.hasPendingAdditionalWorkOther
      ? false
      : isSlotSatisfied(
          stored.hasAdditionalWork,
          inferred.hasAdditionalWork,
          input?.hasAdditionalWork,
          activeChoiceConversationState?.hasAdditionalWork,
          pendingAdditionalWorkOtherPatch.hasAdditionalWork,
        ),
    hasDocumentaryAttachments: isSlotSatisfied(
      stored.hasDocumentaryAttachments,
      inferred.hasDocumentaryAttachments,
      input?.hasDocumentaryAttachments,
      activeChoiceConversationState?.hasDocumentaryAttachments,
    ),
    hasWorkSite:
      merged.hasPendingRemoteWorkSiteRecommendation || merged.declinedRemoteWorkSiteRecommendation
        ? false
        : isSlotSatisfied(
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
    hasProjectTitle: isSlotSatisfied(
      stored.hasProjectTitle,
      inferred.hasProjectTitle,
      input?.hasProjectTitle,
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

function resolvePendingAdditionalWorkOtherPatch(input: {
  stored: Partial<ConversationState>
  latestUserMessage: string
  activeChoiceConversationState: Partial<ConversationState> | undefined
}): Partial<ConversationState> {
  if (input.activeChoiceConversationState?.hasPendingAdditionalWorkOther !== undefined) return {}
  if (!input.stored.hasPendingAdditionalWorkOther) return {}

  const detail = inferAdditionalWorkOtherDetail(input.latestUserMessage)
  if (!detail) {
    return {
      hasAdditionalWork: false,
      hasPendingAdditionalWorkOther: true,
    }
  }

  return {
    hasAdditionalWork: true,
    hasPendingAdditionalWorkOther: false,
    additionalWorkOtherNote: detail,
  }
}

function toMessageUi(
  routingDecision: RoutingDecision | undefined,
  tier: ChatbotLlmResponse["tier"],
  conversationState: ConversationState,
  bookingPrefill: ChatbotBookingPrefill = {},
): ChatbotMessageUi {
  const fallbackUi: ChatbotMessageUi =
    tier === "tier-4-form-fallback" ? { kind: "tier4-inquiry-form" } : { kind: "none" }
  if (!routingDecision) return fallbackUi

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
      busyDateKeys: routingDecision.busyDateKeys,
      jobContext: routingDecision.jobContext,
      conversationState,
      bookingPrefill,
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

  return fallbackUi
}

function buildConversationSummary(jobContext: JobContext, conversationState: ConversationState): ConversationSummary {
  return {
    subject: "チャットボット相談",
    customerEmail: conversationState.contactEmail ?? "",
    ...(conversationState.customerName ? { customerName: conversationState.customerName } : {}),
    ...(conversationState.companyName ? { companyName: conversationState.companyName } : {}),
    jobContext,
    summaryText: "",
    openQuestions: [],
  }
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
  const projectTitle = inferProjectTitleFromText(text)
  const hasDeliveryFormat = /(?:納品形式|納品フォーマット|prores|mp4|mov|h\.?264|h\.?265)/iu.test(text)
  const hasMaterialHandoff =
    /(?:受け渡し|オンライン共有|共有リンク|ギガファイル|gigafile|google\s*drive|dropbox|クラウド|アップロード|sd|hdd|ssd|郵送|持ち込み|搬入|転送)/iu.test(text)
  const hasMaterialDetails =
    /(?:素材内容|カメラ\s*\d+\s*台|カメラ台数|収録形式|解像度|フレームレート|fps|4k|full\s*hd|fullhd|1080|prores|raw|log|s-log)/iu.test(text)
  const hasProductionOptions = /(?:字幕|テロップ|ナレーション|音楽|bgm)/iu.test(text)
  const hasBudgetRange = /(?:予算|ご予算|概算|レンジ|\d+\s*(?:万|万円|円)|budget)/iu.test(text)
  const hasMeetingPreference = /(?:打ち合わせ|ミーティング|オンライン|zoom|meet)/iu.test(text)
  const hasWorkSite = /(?:作業場所|立ち会い|リモート(?:グレーディング|作業|対応)?|スタジオ|現地|ポスプロ|常駐)/u.test(text)
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
    hasProjectTitle: Boolean(projectTitle),
    contactEmail: hasContactEmail ? text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0] : undefined,
    customerName: identity.customerName,
    companyName: identity.companyName,
    ...(projectTitle ? { projectTitle } : {}),
    hasDeliveryFormat,
    hasProductionOptions,
    hasBudgetRange,
    hasMeetingPreference,
  } as Partial<ConversationState>
}

function inferProjectTitleFromText(text: string): string | undefined {
  const patterns = [
    /(?:案件名|プロジェクト名|作品名|タイトル)\s*(?:は|:|：|=)\s*[「『"']?([\s\S]{1,80}?)[」』"']?(?=(?:\s*(?:、|,|。|\n|$)|\s*(?:会社名|社名|所属|担当者氏名|担当者名|担当|氏名|お名前|名前|メール|連絡先|素材|納品|尺|最終媒体)\s*(?:は|:|：|=)))/gu,
    /[「『]([^」』\n]{1,80})[」』]\s*(?:という|の)?(?:案件|作品|プロジェクト)/gu,
  ]

  let latest: string | undefined
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const cleaned = cleanProjectTitle(match[1])
      if (cleaned) latest = cleaned
    }
  }

  return latest
}

function cleanProjectTitle(value: string | undefined): string | undefined {
  if (!value) return undefined
  const cleaned = value
    .replace(/^[\s　「『【（("']+|[\s　」』】）)"']+$/gu, "")
    .replace(/[、,。]+$/u, "")
    .replace(/(?:です|でございます|になります)$/u, "")
    .replace(/\s+/gu, " ")
    .trim()
  if (!cleaned || cleaned.length > 80) return undefined
  if (/^(?:未入力|未定|不明|なし|null|undefined|仮|仮称)$/iu.test(cleaned)) return undefined
  if (/(?:会社名|社名|所属|担当者|担当|氏名|お名前|名前|メール|連絡先|納品形式|作業場所|希望)$/u.test(cleaned)) return undefined
  return cleaned
}

function inferAdditionalWorkOtherDetail(message: string): string | undefined {
  const normalized = message
    .replace(/^選択\s*[:：]\s*/u, "")
    .replace(/[「」『』]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
  if (!normalized || normalized.length > 120) return undefined
  if (/^(?:わかりません|分かりません|不明|未定|謎|詳しくはまた|まだわからない|まだ分からない|要相談|相談したい|その他)$/u.test(normalized)) {
    return undefined
  }
  if (/^(?:はい|いいえ|yes|no|ok|なし|none)$/iu.test(normalized)) return undefined
  return normalized
}

function inferCustomerIdentityFromText(text: string): {
  hasCustomerIdentity: boolean
  customerName?: string
  companyName?: string
} {
  const companyName =
    lastCleanedIdentityMatch(
      text,
      /(?:担当者氏名|担当者名|担当者|担当|氏名|お名前|名前)\s*(?:は|:|：|=)\s*[^\s　、,。\n（）()]{1,30}\s*[（(]\s*([^)）\n]{1,80}?)\s*[）)]/gu,
      "company",
    ) ??
    lastCleanedIdentityMatch(
      text,
      /(?:会社名|社名|所属)\s*(?:は|:|：|=)\s*([\s\S]{1,80}?)(?=(?:\s*(?:、|,|。|\n|$)|\s*(?:会社名|社名|所属|担当者氏名|担当者名|担当|氏名|お名前|名前)\s*(?:は|:|：|=)))/gu,
      "company",
    ) ??
    lastCleanedIdentityMatch(text, /(?:^|[\s　、,。\n])((?:株式会社|合同会社|有限会社)[^\s　、,。の]{1,30})(?=$|[\s　、,。\n])/gu, "company") ??
    lastCleanedIdentityMatch(text, /(?:^|[\s　、,。\n])([^\s　、,。の]{1,30}(?:株式会社|合同会社|有限会社))(?=$|[\s　、,。\n]|です|でございます|と申します)/gu, "company")

  const customerName =
    lastCleanedIdentityMatch(
      text,
      /(?:担当者氏名|担当者名|担当者|担当|氏名|お名前|名前)\s*(?:は|:|：|=)\s*([^\s　、,。\n（）()]{1,30})\s*[（(]\s*[^)）\n]{1,80}?\s*[）)]/gu,
      "person",
    ) ??
    lastCleanedIdentityMatch(
      text,
      /(?:担当者氏名|担当者名|担当者|担当|氏名|お名前|名前)\s*(?:は|:|：|=)\s*([\s\S]{1,80}?)(?=(?:\s*(?:、|,|。|\n|$)|\s*(?:会社名|社名|所属|担当者氏名|担当者名|担当者|担当|氏名|お名前|名前)\s*(?:は|:|：|=)))/gu,
      "person",
    ) ??
    lastCleanedIdentityMatch(
      text,
      /(?:株式会社|合同会社|有限会社)[^\s　、,。の]{1,30}の([^\s　、,。]+?)(?:です|と申します)?(?:[。\n、,]|$)/gu,
      "person",
    )

  return {
    hasCustomerIdentity: /(?:会社|株式会社|合同会社|有限会社|担当|名前|氏名|お名前)/u.test(text),
    ...(customerName ? { customerName } : {}),
    ...(companyName ? { companyName } : {}),
  }
}

function lastCleanedIdentityMatch(text: string, pattern: RegExp, kind: "company" | "person"): string | undefined {
  let latest: string | undefined
  for (const match of text.matchAll(pattern)) {
    const cleaned = cleanInferredIdentityValue(match[1], kind)
    if (cleaned) latest = cleaned
  }
  return latest
}

function cleanInferredIdentityValue(value: string | undefined, kind: "company" | "person"): string | undefined {
  if (!value) return undefined

  let cleaned = value
    .replace(/^[\s　「『【（(]+|[\s　」』】）)]+$/gu, "")
    .replace(/[、,。]+$/u, "")
    .replace(/(?:です|でございます|と申します|になります)$/u, "")
    .replace(/\s+/gu, " ")
    .trim()
  if (kind === "person") {
    cleaned = cleaned.replace(/(?:さん|様)$/u, "").trim()
  }

  if (!cleaned || cleaned === "provided") return undefined
  if (/^(?:株式会社|合同会社|有限会社)$/u.test(cleaned)) return undefined
  if (/(?:共有済み|提供済み|取得済み|未定|不明|連絡先|メール|納品形式|打ち合わせ|作業場所|希望|済み|会社名|社名|所属|担当者|担当|氏名|お名前|名前)/u.test(cleaned)) {
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
  const preferredStartDate = inferPreferredStartDate(text)
  const publicReleaseDate = inferPublicReleaseDate(text)

  return {
    ...(finalMedium ? { finalMedium } : {}),
    ...(/(?:web\s*cm|cm)/iu.test(text) ? { jobKind: "cm-30s" as const } : {}),
    ...(finalMedium === "live" && projectLengthMinutes !== undefined ? { jobKind: "live-60m" as const } : {}),
    ...(projectLengthMinutes ? { projectLengthMinutes } : {}),
    ...(preferredStartDate ? { preferredStartDate: preferredStartDate.date } : {}),
    ...(preferredStartDate?.approximate ? { preferredStartDateApproximate: true } : {}),
    ...(publicReleaseDate ? { publicReleaseDate } : {}),
  }
}

function inferPreferredStartDate(text: string): { date: string; approximate?: boolean } | undefined {
  const isoLike = text.match(/(?:搬入|受け取り|受取|作業|開始)[^\n。、,]*(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})/u)
  if (isoLike?.[1] && isoLike[2] && isoLike[3]) return { date: formatIsoDate(isoLike[1], isoLike[2], isoLike[3]) }

  const slash = text.match(/(?:搬入|受け取り|受取|作業|開始)[^\n。、,]*(\d{1,2})\/(\d{1,2})/u)
  if (slash?.[1] && slash[2]) return { date: formatIsoDate("2026", slash[1], slash[2]) }

  const monthDay = text.match(/(?:搬入|受け取り|受取|作業|開始)[^\n。、,]*(\d{1,2})月(\d{1,2})日/u)
  if (monthDay?.[1] && monthDay[2]) return { date: formatIsoDate("2026", monthDay[1], monthDay[2]) }

  const earlyMonth = text.match(/(?:搬入|受け取り|受取|作業|開始)[^\n。、,]*(\d{1,2})月上旬/u)
  if (earlyMonth?.[1]) return { date: formatIsoDate("2026", earlyMonth[1], "1"), approximate: true }

  const middleMonth = text.match(/(?:搬入|受け取り|受取|作業|開始)?[^\n。、,]*(\d{1,2}|[１２３４５６７８９]|[一二三四五六七八九])月(?:中旬|中頃|なかば)/u)
  if (middleMonth?.[1]) return { date: formatIsoDate("2026", normalizeMonthNumber(middleMonth[1]), "15"), approximate: true }

  const withinMonth = text.match(/(?:搬入|受け取り|受取|作業|開始)[^\n。、,]*(\d{1,2}|[１２３４５６７８９]|[一二三四五六七八九])月中/u)
  if (withinMonth?.[1]) return { date: formatIsoDate("2026", normalizeMonthNumber(withinMonth[1]), "1"), approximate: true }
  return undefined
}

function inferPublicReleaseDate(text: string): string | undefined {
  const isoLike = text.match(/(?:納品|納期|公開|リリース|締切|締め切り)[^\n。、,]*(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})/u)
  if (isoLike?.[1] && isoLike[2] && isoLike[3]) return formatIsoDate(isoLike[1], isoLike[2], isoLike[3])

  const slash = text.match(/(?:納品|納期|公開|リリース|締切|締め切り)[^\n。、,]*(\d{1,2})\/(\d{1,2})/u)
  if (slash?.[1] && slash[2]) return formatIsoDate("2026", slash[1], slash[2])

  const monthDay =
    text.match(/(?:納品|納期|公開|リリース|締切|締め切り)[^\n。、,]*(\d{1,2})月(\d{1,2})日/u) ??
    text.match(/(\d{1,2})月(\d{1,2})日[^\n。、,]*(?:納品|納期|公開|リリース|締切|締め切り)/u)
  if (monthDay?.[1] && monthDay[2]) return formatIsoDate("2026", monthDay[1], monthDay[2])

  const monthEnd = text.match(/(?:(\d{1,2}|[１２３４５６７８９]|[一二三四五六七八九])月末|(?:納品|納期|公開|リリース|締切|締め切り)[^\n。、,]*(\d{1,2}|[１２３４５６７８９]|[一二三四五六七八九])月中)/u)
  const month = monthEnd?.[1] ?? monthEnd?.[2]
  if (month) return formatIsoDate("2026", normalizeMonthNumber(month), String(lastDayOfMonth(2026, Number(normalizeMonthNumber(month)))))

  return undefined
}

function formatIsoDate(year: string, month: string, day: string): string {
  return [
    year,
    normalizeMonthNumber(month).padStart(2, "0"),
    day.padStart(2, "0"),
  ].join("-")
}

function normalizeMonthNumber(value: string): string {
  const normalized = value
    .replace(/[０-９]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace("一", "1")
    .replace("二", "2")
    .replace("三", "3")
    .replace("四", "4")
    .replace("五", "5")
    .replace("六", "6")
    .replace("七", "7")
    .replace("八", "8")
    .replace("九", "9")
  return normalized
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
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
