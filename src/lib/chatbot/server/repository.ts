import type {
  ChatbotInquiry as DbChatbotInquiry,
  ChatbotSurveyResponse as DbChatbotSurveyResponse,
  Prisma,
  PrismaClient,
} from "@prisma/client"

import type {
  ChatbotConversation,
  ChatbotConversationContext,
  ChatbotMessage,
  ChatbotMessageRole,
  ConversationState,
  ConversationSummary,
  DocumentaryAttachment,
  FinalMedium,
  JobContext,
  JobKind,
  RoutingDecision,
  SurveyChoiceSet,
  WorkSite,
} from "@/lib/chatbot/domain"
import { prisma } from "@/lib/prisma"

type RoutingDecisionKind = RoutingDecision["kind"]
type ChatbotRepositoryClient = Prisma.TransactionClient | PrismaClient

type ChatbotConversationRow = Prisma.ChatbotConversationGetPayload<{
  include: { messages: true }
}>

type ChatbotMessageRow = Prisma.ChatbotMessageGetPayload<Record<string, never>>

type InquiryCreateData = Prisma.ChatbotInquiryCreateInput
type RepositoryContextFields = {
  currentQuestion: string | null
  activeChoices: string | null
  conversationState: string | null
}

const routingDecisionKinds = [
  "continue",
  "to-booking-inline",
  "to-email",
  "to-direct-contact",
] as const satisfies readonly RoutingDecisionKind[]

const messageRoles = ["user", "assistant", "system"] as const satisfies readonly ChatbotMessageRole[]
const jobKinds = [
  "cm-30s",
  "mv-5m",
  "feature-90m",
  "drama-first",
  "drama-follow-up",
  "vertical-60s",
  "live-60m",
] as const satisfies readonly JobKind[]
const finalMediums = ["ott", "cinema", "tv-broadcast", "live", "web", "vertical-sns", "other"] as const
const workSites = ["satoshi-studio", "remote-grading", "on-site"] as const
const additionalWorkKinds = ["retouch", "skin-retouch", "other"] as const

export async function createConversation(input: {
  sessionId: string
  userId?: string | null
}): Promise<ChatbotConversation> {
  const row = await prisma.chatbotConversation.create({
    data: {
      sessionId: input.sessionId,
      userId: input.userId ?? null,
      routingDecision: "continue",
    },
  })

  return toDomainConversation(withDefaultRepositoryContextFields({ ...row, messages: [] }))
}

export async function loadConversationBySessionId(
  sessionId: string,
): Promise<ChatbotConversation | null> {
  const row = await prisma.chatbotConversation.findUnique({
    where: { sessionId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!row) return null
  return toDomainConversation(await withRepositoryContextFields(row))
}

export async function loadConversationById(
  conversationId: string,
): Promise<ChatbotConversation | null> {
  const row = await prisma.chatbotConversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!row) return null
  return toDomainConversation(await withRepositoryContextFields(row))
}

export async function appendMessage(input: {
  id?: string
  conversationId: string
  role: ChatbotMessageRole
  content: string
}): Promise<ChatbotMessage> {
  const row = await prisma.$transaction(async (tx) => {
    const message = await tx.chatbotMessage.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
      },
    })

    await tx.chatbotConversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: message.createdAt },
    })

    return message
  })

  return toDomainMessage(row)
}

export async function truncateConversationFromMessage(input: {
  conversationId: string
  messageId: string
}): Promise<{ deletedCount: number }> {
  return prisma.$transaction(async (tx) => {
    const messages = await tx.chatbotMessage.findMany({
      where: { conversationId: input.conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    })
    const targetIndex = messages.findIndex((message) => message.id === input.messageId)
    if (targetIndex === -1) {
      throw new Error("chatbot_edit_target_not_found")
    }

    const deleteIds = messages.slice(targetIndex).map((message) => message.id)
    const deleteResult = await tx.chatbotMessage.deleteMany({
      where: {
        conversationId: input.conversationId,
        id: { in: deleteIds },
      },
    })

    await tx.chatbotConversation.update({
      where: { id: input.conversationId },
      data: {
        routingDecision: "continue",
        bookingId: null,
        finalMedium: null,
        jobType: null,
        mainDuration: null,
        workSite: null,
        attachments: null,
        additionalWork: null,
        referenceUrls: null,
      },
    })
    await updateRepositoryContextFields(tx, {
      conversationId: input.conversationId,
      currentQuestion: null,
      activeChoices: null,
      conversationState: null,
    })

    return { deletedCount: deleteResult.count }
  })
}

export async function recordSurveyResponse(input: {
  conversationId: string
  question: string
  selectedChoiceIds: string[]
  freeText?: string | null
}): Promise<DbChatbotSurveyResponse> {
  return prisma.chatbotSurveyResponse.create({
    data: {
      conversationId: input.conversationId,
      question: input.question,
      selectedValues: JSON.stringify(input.selectedChoiceIds),
      freeText: input.freeText ?? null,
    },
  })
}

export async function recordInquiry(input: {
  conversationId: string
  routingDecisionKind: RoutingDecisionKind
  summary: ConversationSummary
  sentAt: Date
  emailMessageId?: string | null
}): Promise<DbChatbotInquiry> {
  return prisma.$transaction(async (tx) => {
    const inquiry = await tx.chatbotInquiry.create({
      data: toInquiryCreateData(input),
    })

    await updateConversationRoutingFields(tx, {
      conversationId: input.conversationId,
      routingDecision: input.routingDecisionKind,
      inquirySentAt: input.sentAt,
      summary: input.summary,
    })

    return inquiry
  })
}

export async function updateConversationRouting(input: {
  conversationId: string
  routingDecision: RoutingDecisionKind
  currentQuestion?: string | null
  activeChoices?: SurveyChoiceSet | null
  conversationState?: ConversationState
  jobContext?: JobContext
}): Promise<void> {
  await prisma.chatbotConversation.update({
    where: { id: input.conversationId },
    data: {
      routingDecision: input.routingDecision,
      ...(input.jobContext ? toJobContextUpdateData(input.jobContext) : {}),
    },
  })
  await updateRepositoryContextFields(prisma, {
    conversationId: input.conversationId,
    currentQuestion: input.currentQuestion ?? null,
    activeChoices: serializeActiveChoices(input.activeChoices ?? null),
    conversationState: serializeConversationState(input.conversationState ?? null),
  })
}

export async function updateConversationSlackThreadTs(input: {
  conversationId: string
  slackThreadTs: string
}): Promise<void> {
  await prisma.chatbotConversation.updateMany({
    where: {
      id: input.conversationId,
      slackThreadTs: null,
    },
    data: { slackThreadTs: input.slackThreadTs },
  })
}

export async function linkConversationToUser(input: {
  conversationId: string
  userId: string
}): Promise<void> {
  await prisma.chatbotConversation.update({
    where: { id: input.conversationId },
    data: { userId: input.userId },
  })
}

export async function linkChatToBookingGroup(input: {
  conversationId: string
  bookingGroupId: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const [contextFields] = await tx.$queryRaw<RepositoryContextFields[]>`
      SELECT "currentQuestion", "activeChoices", "conversationState"
      FROM "ChatbotConversation"
      WHERE "id" = ${input.conversationId}
      LIMIT 1
    `
    const submittedAt = new Date()
    const conversationState = serializeConversationState(
      withSubmittedBookingState(toConversationState(contextFields?.conversationState) ?? {}, {
        reservationNumber: input.bookingGroupId,
        submittedAt: submittedAt.toISOString(),
      }),
    )

    await tx.bookingGroup.update({
      where: { id: input.bookingGroupId },
      data: {
        originatedFrom: "chatbot",
        chatConversationId: input.conversationId,
      },
    })

    await tx.chatbotConversation.update({
      where: { id: input.conversationId },
      data: {
        bookingId: input.bookingGroupId,
        routingDecision: "to-booking-inline",
      },
    })
    await updateRepositoryContextFields(tx, {
      conversationId: input.conversationId,
      currentQuestion: contextFields?.currentQuestion ?? null,
      activeChoices: contextFields?.activeChoices ?? null,
      conversationState,
    })
  })
}

function toDomainConversation(row: ChatbotConversationRow): ChatbotConversation {
  const routingDecisionKind = toRoutingDecisionKind(row.routingDecision)
  const jobContext = toJobContext(row)
  const activeChoices = toSurveyChoiceSet(row.activeChoices)
  const conversationState = row.bookingId
    ? withSubmittedBookingState(toConversationState(row.conversationState) ?? {}, {
        reservationNumber: row.bookingId,
      })
    : toConversationState(row.conversationState)
  const context: ChatbotConversationContext = {
    sessionId: row.sessionId,
    ...(row.userId ? { userId: row.userId } : {}),
    ...(row.customerEmail ? { customerEmail: row.customerEmail } : {}),
    ...(row.slackThreadTs ? { slackThreadTs: row.slackThreadTs } : {}),
    ...(row.currentQuestion ? { currentQuestion: row.currentQuestion } : {}),
    ...(activeChoices ? { activeChoices } : {}),
    ...(conversationState ? { conversationState } : {}),
    ...(Object.keys(jobContext).length > 0 ? { jobContext } : {}),
  }

  return {
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    updatedAt: row.lastMessageAt.toISOString(),
    status: toConversationStatus(routingDecisionKind),
    context,
    messages: row.messages.map(toDomainMessage),
  }
}

function withDefaultRepositoryContextFields<T extends Partial<RepositoryContextFields>>(
  row: T,
): T & RepositoryContextFields {
  return {
    ...row,
    currentQuestion: row.currentQuestion ?? null,
    activeChoices: row.activeChoices ?? null,
    conversationState: row.conversationState ?? null,
  }
}

async function withRepositoryContextFields<T extends { id: string } & Partial<RepositoryContextFields>>(
  row: T,
): Promise<T & RepositoryContextFields> {
  if (
    "currentQuestion" in row &&
    "activeChoices" in row &&
    "conversationState" in row
  ) {
    return withDefaultRepositoryContextFields(row)
  }

  const [fields] = await prisma.$queryRaw<RepositoryContextFields[]>`
    SELECT "currentQuestion", "activeChoices", "conversationState"
    FROM "ChatbotConversation"
    WHERE "id" = ${row.id}
    LIMIT 1
  `
  return withDefaultRepositoryContextFields({ ...row, ...fields })
}

async function updateRepositoryContextFields(
  client: ChatbotRepositoryClient,
  input: RepositoryContextFields & { conversationId: string },
): Promise<void> {
  await client.$executeRaw`
    UPDATE "ChatbotConversation"
    SET
      "currentQuestion" = ${input.currentQuestion},
      "activeChoices" = ${input.activeChoices},
      "conversationState" = ${input.conversationState}
    WHERE "id" = ${input.conversationId}
  `
}

function toDomainMessage(row: ChatbotMessageRow): ChatbotMessage {
  return {
    id: row.id,
    role: toMessageRole(row.role),
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  }
}

function toInquiryCreateData(input: {
  conversationId: string
  routingDecisionKind: RoutingDecisionKind
  summary: ConversationSummary
  sentAt: Date
}): InquiryCreateData {
  const { jobContext } = input.summary

  return {
    conversation: {
      connect: { id: input.conversationId },
    },
    customerEmail: input.summary.customerEmail,
    finalMedium: jobContext.finalMedium,
    jobType: input.summary.subject,
    mainDuration:
      typeof jobContext.projectLengthMinutes === "number"
        ? String(jobContext.projectLengthMinutes)
        : null,
    workSite: jobContext.workSite,
    attachments: JSON.stringify(jobContext.documentaryAttachment),
    additionalWork: jobContext.additionalWork ? JSON.stringify(jobContext.additionalWork) : null,
    referenceUrls: jobContext.referenceUrls ? JSON.stringify(jobContext.referenceUrls) : null,
    desiredDeadline: jobContext.publicReleaseDate ?? null,
    freeText: input.summary.openQuestions.join("\n"),
    aiSummary: input.summary.summaryText,
    workflowEstimate: jobContext.workflowEstimate ? JSON.stringify(jobContext.workflowEstimate) : null,
    candidateWindows: null,
    sentReason: input.routingDecisionKind,
    sentAt: input.sentAt,
  }
}

async function updateConversationRoutingFields(
  client: ChatbotRepositoryClient,
  input: {
    conversationId: string
    routingDecision: RoutingDecisionKind
    inquirySentAt?: Date
    summary?: ConversationSummary
  },
): Promise<void> {
  await client.chatbotConversation.update({
    where: { id: input.conversationId },
    data: {
      routingDecision: input.routingDecision,
      inquirySentAt: input.inquirySentAt,
      ...(input.summary ? toConversationSummaryUpdateData(input.summary) : {}),
    },
  })
}

function toConversationSummaryUpdateData(
  summary: ConversationSummary,
): Prisma.ChatbotConversationUpdateInput {
  const { jobContext } = summary

  return {
    customerName: summary.customerName ?? null,
    customerCompany: summary.companyName ?? null,
    customerEmail: summary.customerEmail,
    finalMedium: jobContext.finalMedium,
    jobType: summary.subject,
    mainDuration:
      typeof jobContext.projectLengthMinutes === "number"
        ? String(jobContext.projectLengthMinutes)
        : null,
    workSite: jobContext.workSite,
    attachments: JSON.stringify(jobContext.documentaryAttachment),
    additionalWork: jobContext.additionalWork ? JSON.stringify(jobContext.additionalWork) : null,
    referenceUrls: jobContext.referenceUrls ? JSON.stringify(jobContext.referenceUrls) : null,
  }
}

function toJobContextUpdateData(jobContext: JobContext): Prisma.ChatbotConversationUpdateInput {
  return {
    finalMedium: jobContext.finalMedium,
    jobType: jobContext.jobKind ?? null,
    mainDuration:
      typeof jobContext.projectLengthMinutes === "number"
        ? String(jobContext.projectLengthMinutes)
        : null,
    workSite: jobContext.workSite,
    attachments: JSON.stringify(jobContext.documentaryAttachment),
    additionalWork: jobContext.additionalWork ? JSON.stringify(jobContext.additionalWork) : null,
    referenceUrls: jobContext.referenceUrls ? JSON.stringify(jobContext.referenceUrls) : null,
  }
}

function toJobContext(row: ChatbotConversationRow): Partial<JobContext> {
  const jobContext: Partial<JobContext> = {}
  const finalMedium = toFinalMedium(row.finalMedium)
  const workSite = toWorkSite(row.workSite)
  const documentaryAttachment = toDocumentaryAttachment(row.attachments)
  const additionalWork = toAdditionalWork(row.additionalWork)
  const referenceUrls = toStringArray(row.referenceUrls)
  const projectLengthMinutes = toNumber(row.mainDuration)
  const jobKind = toJobKind(row.jobType)

  if (jobKind) jobContext.jobKind = jobKind
  if (finalMedium) jobContext.finalMedium = finalMedium
  if (workSite) jobContext.workSite = workSite
  if (documentaryAttachment) jobContext.documentaryAttachment = documentaryAttachment
  if (additionalWork) jobContext.additionalWork = additionalWork
  if (referenceUrls) jobContext.referenceUrls = referenceUrls
  if (typeof projectLengthMinutes === "number") jobContext.projectLengthMinutes = projectLengthMinutes

  return jobContext
}

function toJobKind(value: string | null): JobKind | undefined {
  if (value === null) return undefined
  if (isOneOf(value, jobKinds)) return value
  return undefined
}

function toConversationStatus(
  routingDecisionKind: RoutingDecisionKind | null,
): ChatbotConversation["status"] {
  switch (routingDecisionKind) {
    case null:
    case "continue":
      return "open"
    case "to-booking-inline":
      return "handoff-booking"
    case "to-email":
      return "handoff-email"
    case "to-direct-contact":
      return "direct-contact"
  }
}

function toRoutingDecisionKind(value: string | null): RoutingDecisionKind | null {
  if (value === null) return null
  if (isOneOf(value, routingDecisionKinds)) return value
  throw new Error(`Unknown chatbot routing decision: ${value}`)
}

function toMessageRole(value: string): ChatbotMessageRole {
  if (isOneOf(value, messageRoles)) return value
  throw new Error(`Unknown chatbot message role: ${value}`)
}

function toFinalMedium(value: string | null): FinalMedium | undefined {
  if (value === null) return undefined
  if (isOneOf(value, finalMediums)) return value
  throw new Error(`Unknown chatbot final medium: ${value}`)
}

function toWorkSite(value: string | null): WorkSite | undefined {
  if (value === null) return undefined
  if (isOneOf(value, workSites)) return value
  throw new Error(`Unknown chatbot work site: ${value}`)
}

function toDocumentaryAttachment(value: string | null): DocumentaryAttachment | undefined {
  if (value === null) return undefined
  return parseJson(value, "documentary attachment") as DocumentaryAttachment
}

function toAdditionalWork(value: string | null): JobContext["additionalWork"] | undefined {
  const parsed = toStringArray(value)
  if (!parsed) return undefined
  for (const item of parsed) {
    if (!isOneOf(item, additionalWorkKinds)) {
      throw new Error(`Unknown chatbot additional work: ${item}`)
    }
  }
  return parsed as JobContext["additionalWork"]
}

function toSurveyChoiceSet(value: string | null | undefined): SurveyChoiceSet | undefined {
  if (value == null) return undefined
  const parsed = parseJson(value, "active choices")
  const normalized = normalizeSurveyChoiceSet(parsed)
  if (!normalized) {
    throw new Error("Invalid chatbot active choices JSON")
  }
  return normalized
}

function serializeActiveChoices(value: SurveyChoiceSet | null): string | null {
  return value ? JSON.stringify(value) : null
}

function serializeConversationState(value: Partial<ConversationState> | null): string | null {
  return value ? JSON.stringify(value) : null
}

function toConversationState(value: string | null | undefined): Partial<ConversationState> | undefined {
  if (value == null) return undefined
  const parsed = parseJson(value, "conversation state")
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid chatbot conversation state JSON")
  }
  return parsed as Partial<ConversationState>
}

function withSubmittedBookingState(
  state: Partial<ConversationState>,
  input: { reservationNumber: string; submittedAt?: string },
): Partial<ConversationState> {
  const rest = { ...state }
  delete rest.bookingFinalConfirmation
  return {
    ...rest,
    bookingSubmission: {
      status: "submitted",
      reservationNumber: input.reservationNumber,
      ...(input.submittedAt ? { submittedAt: input.submittedAt } : {}),
    },
  }
}

function toStringArray(value: string | null): string[] | undefined {
  if (value === null) return undefined
  const parsed = parseJson(value, "string array")
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("Invalid chatbot string array JSON")
  }
  return parsed
}

function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid chatbot ${label} JSON`, { cause: error })
  }
}

function isOneOf<const T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return allowed.includes(value)
}

function normalizeSurveyChoiceSet(value: unknown): SurveyChoiceSet | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const candidate = value as Partial<SurveyChoiceSet>
  const id = candidate.id
  const question = candidate.question
  const choices = candidate.choices
  const selectionMode = candidate.selectionMode ?? "single"
  const allowFreeText = candidate.allowFreeText
  const isValid =
    typeof id === "string" &&
    typeof question === "string" &&
    (allowFreeText === undefined || typeof allowFreeText === "boolean") &&
    (selectionMode === "single" || selectionMode === "multiple") &&
    Array.isArray(choices) &&
    choices.every(
      (choice) =>
        choice &&
        typeof choice === "object" &&
        !Array.isArray(choice) &&
        typeof (choice as { id?: unknown }).id === "string" &&
        typeof (choice as { label?: unknown }).label === "string",
    )
  if (!isValid) return null
  return {
    id,
    question,
    selectionMode,
    ...(allowFreeText === true ? { allowFreeText } : {}),
    choices,
  }
}

export const __chatbotRepositoryTestUtils = {
  toDomainConversation,
  toDomainMessage,
  toInquiryCreateData,
  serializeActiveChoices,
  serializeConversationState,
  withSubmittedBookingState,
  normalizeSurveyChoiceSet,
  withDefaultRepositoryContextFields,
}
