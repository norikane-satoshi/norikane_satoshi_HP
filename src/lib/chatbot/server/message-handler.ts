import type {
  BookingCardPrefill,
  ChatbotConversation,
  ChatbotMessage,
  ConversationState,
  JobContext,
  RoutingDecision,
} from "@/lib/chatbot/domain"
import {
  appendMessage,
  createChatbotLlmTierOrchestrator,
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
  type UserChatbotContext,
} from "@/lib/chatbot/server"
import { ChatbotAvailabilityError, findCandidateWindows } from "@/lib/chatbot/server/availability-finder"
import { estimateWorkflow } from "@/lib/chatbot/server/duration-estimator"
import { decideRoutingFallback } from "@/lib/chatbot/server/routing"

type ChatbotMessageUi =
  | { kind: "none" }
  | { kind: "choice-panel"; choiceSet: NonNullable<Extract<RoutingDecision, { kind: "continue" }>["presentChoices"]> }
  | {
      kind: "booking-card"
      suggestedSlots: Extract<RoutingDecision, { kind: "to-booking-inline" }>["suggestedSlots"]
      jobContext: JobContext
      bookingPrefill?: BookingCardPrefill
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
  candidateWindowFinder?: typeof findCandidateWindows
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
  const candidateWindowFinder = options.candidateWindowFinder ?? findCandidateWindows
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
  const routingDecision = await resolveRoutingDecision({
    llmResponse,
    jobContext,
    candidateWindowFinder,
  })
  const assistantContent = buildAssistantDisplayContent({
    rawText: llmResponse.rawText,
    routingDecision,
    fallbackRoutingDecision: decideRoutingFallback({ jobContext, conversationState, latestUserMessage: input.message }),
  })
  const assistantMessage = await repository.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: assistantContent,
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
    ui: toMessageUi({ ...llmResponse, proposedRoutingDecision: routingDecision }),
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
    createTier1ChromeNotionAiClient(),
    createTier2OllamaDeepSeekClient(),
    createTier4FormFallbackClient(),
  ]
  return createChatbotLlmTierOrchestrator({ clients })
}

function buildChatbotSystemPrompt(
  userContext?: UserChatbotContext | null,
  userContextFormatter: typeof formatUserChatbotContextForPrompt = formatUserChatbotContextForPrompt,
): string {
  const lines = [
    "あなたは新規映像案件の相談受付アシスタントです。",
    "回答範囲は新規案件の調整、要件整理、予約導線に限定し、技術指導、作品レビュー、標準外要望は担当者確認へ誘導します。",
    "不明なことを推測で断定せず、未確認事項として質問します。",
    "LOOK Decomposer v2 の詳細には触れず、直接確認が必要な事項として扱います。",
    "2026年10月より前は作業場所のデフォルト提案をせず、クライアントの希望を先に確認します。",
    "呼称は中立に保ち、他顧客の情報を参照または推測しません。",
    "ユーザーへの表示文は直近ユーザー入力への返答だけにし、内部識別、バックエンド名、dispatcher/JSON タスクの説明だけを返しません。",
    '予約候補カードを出すべきと判断した時だけ、本文に {"tool":"show_booking_card","args":{"projectTitle":"...","contactName":"...","contactEmail":"...","companyName":"...","dueDate":"YYYY-MM-DD"}} を 1 個だけ含めます。',
    "show_booking_card の args は会話で明示された値だけを書き、未確認・不完全なメールや不足項目がある時は tool を呼ばず自然に聞き返します。",
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

function buildAssistantDisplayContent(input: {
  rawText: string
  routingDecision: RoutingDecision | undefined
  fallbackRoutingDecision: RoutingDecision
}): string {
  const text = input.rawText.trim()
  const toolFreeText = stripShowBookingCardToolCall(text).trim()
  if (input.routingDecision?.kind === "to-booking-inline" && toolFreeText.length === 0) {
    return "候補日を確認しました。"
  }
  if (toolFreeText !== text) return toolFreeText
  if (!isBackendIdentityOnlyResponse(text)) return text

  const routingDecision =
    input.routingDecision?.kind === "continue" ? input.routingDecision : input.fallbackRoutingDecision
  if (routingDecision.kind === "continue") return routingDecision.nextQuestion

  return text
}

function isBackendIdentityOnlyResponse(text: string): boolean {
  const compact = text.replace(/\s+/g, "")
  return (
    compact === "のりかね映像設計室の相談窓口として動いています" ||
    compact === "のりかね映像設計室のご相談窓口として動いています"
  )
}

function buildConversationState(
  input: Partial<ConversationState> | undefined,
  conversation: ChatbotConversation,
  userMessage: ChatbotMessage,
): ConversationState {
  const userTurnCount =
    conversation.messages.filter((message) => message.role === "user").length +
    (userMessage.role === "user" ? 1 : 0)

  return {
    hasFinalMedium: false,
    hasJobKind: false,
    hasAdditionalWork: false,
    hasDocumentaryAttachments: false,
    hasWorkSite: false,
    hasReferenceUrls: false,
    hasContactEmail: false,
    hasDesiredSchedule: false,
    turnCount: userTurnCount,
    ...(input ?? {}),
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
      bookingPrefill: routingDecision.bookingPrefill,
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

async function resolveRoutingDecision(input: {
  llmResponse: ChatbotLlmResponse
  jobContext: JobContext
  candidateWindowFinder: typeof findCandidateWindows
}): Promise<RoutingDecision | undefined> {
  if (input.llmResponse.proposedRoutingDecision) return input.llmResponse.proposedRoutingDecision

  const toolCall = parseShowBookingCardToolCall(input.llmResponse.rawText)
  if (!toolCall) return undefined
  if (!input.jobContext.jobKind) return undefined

  const workflowEstimate = estimateWorkflow(input.jobContext)
  const jobContext = {
    ...input.jobContext,
    workflowEstimate,
  }

  try {
    const suggestedSlots = await input.candidateWindowFinder({
      jobContext,
      workflowEstimate,
      desiredDeadline: toolCall.args.dueDate,
    })

    return {
      kind: "to-booking-inline",
      suggestedSlots,
      jobContext,
      bookingPrefill: toolCall.args,
    }
  } catch (error) {
    if (error instanceof ChatbotAvailabilityError) return undefined
    throw error
  }
}

type ShowBookingCardToolCall = {
  tool: "show_booking_card"
  args: BookingCardPrefill
}

function parseShowBookingCardToolCall(text: string): ShowBookingCardToolCall | undefined {
  for (const candidate of extractJsonObjectCandidates(text)) {
    const parsed = parseJson(candidate)
    if (!isRecord(parsed) || parsed.tool !== "show_booking_card" || !isRecord(parsed.args)) continue

    return {
      tool: "show_booking_card",
      args: {
        projectTitle: optionalString(parsed.args.projectTitle),
        contactName: optionalString(parsed.args.contactName),
        contactEmail: optionalString(parsed.args.contactEmail),
        companyName: optionalString(parsed.args.companyName),
        dueDate: optionalString(parsed.args.dueDate),
      },
    }
  }

  return undefined
}

function stripShowBookingCardToolCall(text: string): string {
  let next = text
  for (const candidate of extractJsonObjectCandidates(text)) {
    if (parseShowBookingCardToolCall(candidate)) {
      next = next.replace(candidate, "")
    }
  }

  return next
    .replace(/```json\s*```/gi, "")
    .replace(/```\s*```/g, "")
}

function extractJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = []
  const fencedPattern = /```(?:json)?\s*([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  while ((match = fencedPattern.exec(text))) {
    const body = match[1]?.trim()
    if (body?.startsWith("{") && body.endsWith("}")) candidates.push(body)
  }

  const trimmed = text.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) candidates.push(trimmed)

  const firstBrace = text.indexOf("{")
  const lastBrace = text.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1))
  }

  return [...new Set(candidates)]
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
