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
  ConversationSummary,
  DocumentaryAttachment,
  FinalMedium,
  JobContext,
  RoutingDecision,
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

const routingDecisionKinds = [
  "continue",
  "to-booking-inline",
  "to-email",
  "to-direct-contact",
] as const satisfies readonly RoutingDecisionKind[]

const messageRoles = ["user", "assistant", "system"] as const satisfies readonly ChatbotMessageRole[]
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

  return toDomainConversation({ ...row, messages: [] })
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

  return row ? toDomainConversation(row) : null
}

export async function appendMessage(input: {
  conversationId: string
  role: ChatbotMessageRole
  content: string
}): Promise<ChatbotMessage> {
  const row = await prisma.$transaction(async (tx) => {
    const message = await tx.chatbotMessage.create({
      data: {
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
}): Promise<void> {
  await prisma.chatbotConversation.update({
    where: { id: input.conversationId },
    data: { routingDecision: input.routingDecision },
  })
}

export async function linkChatToBookingGroup(input: {
  conversationId: string
  bookingGroupId: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
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
  })
}

function toDomainConversation(row: ChatbotConversationRow): ChatbotConversation {
  const routingDecisionKind = toRoutingDecisionKind(row.routingDecision)
  const jobContext = toJobContext(row)
  const context: ChatbotConversationContext = {
    sessionId: row.sessionId,
    ...(row.userId ? { userId: row.userId } : {}),
    ...(row.customerEmail ? { customerEmail: row.customerEmail } : {}),
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

function toJobContext(row: ChatbotConversationRow): Partial<JobContext> {
  const jobContext: Partial<JobContext> = {}
  const finalMedium = toFinalMedium(row.finalMedium)
  const workSite = toWorkSite(row.workSite)
  const documentaryAttachment = toDocumentaryAttachment(row.attachments)
  const additionalWork = toAdditionalWork(row.additionalWork)
  const referenceUrls = toStringArray(row.referenceUrls)
  const projectLengthMinutes = toNumber(row.mainDuration)

  if (finalMedium) jobContext.finalMedium = finalMedium
  if (workSite) jobContext.workSite = workSite
  if (documentaryAttachment) jobContext.documentaryAttachment = documentaryAttachment
  if (additionalWork) jobContext.additionalWork = additionalWork
  if (referenceUrls) jobContext.referenceUrls = referenceUrls
  if (typeof projectLengthMinutes === "number") jobContext.projectLengthMinutes = projectLengthMinutes

  return jobContext
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

export const __chatbotRepositoryTestUtils = {
  toDomainConversation,
  toDomainMessage,
  toInquiryCreateData,
}
