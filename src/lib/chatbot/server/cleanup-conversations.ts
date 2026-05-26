import { prisma } from "@/lib/prisma"

export const CHATBOT_CONVERSATION_RETENTION_DAYS = 30
const DEFAULT_BATCH_SIZE = 100
const DAY_MS = 24 * 60 * 60 * 1000

export type CleanupExpiredChatbotConversationsResult = {
  cutoffIso: string
  retentionDays: number
  scannedConversationCount: number
  deletedConversationCount: number
  deletedMessageCount: number
  deletedSurveyResponseCount: number
  deletedInquiryCount: number
  unlinkedBookingGroupCount: number
}

export async function cleanupExpiredChatbotConversations(input: {
  now?: Date
  retentionDays?: number
  batchSize?: number
} = {}): Promise<CleanupExpiredChatbotConversationsResult> {
  const now = input.now ?? new Date()
  const retentionDays = positiveInteger(input.retentionDays, CHATBOT_CONVERSATION_RETENTION_DAYS)
  const batchSize = positiveInteger(input.batchSize, DEFAULT_BATCH_SIZE)
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS)
  const cutoffIso = cutoff.toISOString()

  const conversations = await prisma.chatbotConversation.findMany({
    where: { lastMessageAt: { lt: cutoff } },
    select: { id: true },
    orderBy: { lastMessageAt: "asc" },
    take: batchSize,
  })

  const conversationIds = conversations.map((conversation) => conversation.id)
  if (conversationIds.length === 0) {
    return emptyResult({ cutoffIso, retentionDays })
  }

  const result = await prisma.$transaction(async (tx) => {
    const bookingGroups = await tx.bookingGroup.updateMany({
      where: { chatConversationId: { in: conversationIds } },
      data: { chatConversationId: null },
    })
    const inquiries = await tx.chatbotInquiry.deleteMany({
      where: { conversationId: { in: conversationIds } },
    })
    const surveyResponses = await tx.chatbotSurveyResponse.deleteMany({
      where: { conversationId: { in: conversationIds } },
    })
    const messages = await tx.chatbotMessage.deleteMany({
      where: { conversationId: { in: conversationIds } },
    })
    const conversationsDeleted = await tx.chatbotConversation.deleteMany({
      where: { id: { in: conversationIds } },
    })

    return {
      unlinkedBookingGroupCount: bookingGroups.count,
      deletedInquiryCount: inquiries.count,
      deletedSurveyResponseCount: surveyResponses.count,
      deletedMessageCount: messages.count,
      deletedConversationCount: conversationsDeleted.count,
    }
  })

  return {
    cutoffIso,
    retentionDays,
    scannedConversationCount: conversationIds.length,
    ...result,
  }
}

function emptyResult(input: {
  cutoffIso: string
  retentionDays: number
}): CleanupExpiredChatbotConversationsResult {
  return {
    cutoffIso: input.cutoffIso,
    retentionDays: input.retentionDays,
    scannedConversationCount: 0,
    deletedConversationCount: 0,
    deletedMessageCount: 0,
    deletedSurveyResponseCount: 0,
    deletedInquiryCount: 0,
    unlinkedBookingGroupCount: 0,
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  const integer = Math.floor(value)
  return integer > 0 ? integer : fallback
}
