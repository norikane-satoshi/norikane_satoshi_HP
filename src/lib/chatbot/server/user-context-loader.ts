import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"

const defaultMaxConversations = 5
const defaultMaxBookings = 5
const defaultMaxPromptCharacters = 2800

type ConversationRow = Prisma.ChatbotConversationGetPayload<{
  include: { inquiry: true }
}>

type BookingRow = Prisma.BookingGroupGetPayload<{
  include: { timeSlots: true }
}>

export type UserChatbotContextConversation = {
  id: string
  subject?: string
  finalMedium?: string
  jobType?: string
  workSite?: string
  publicReleaseDate?: string
  summaryText?: string
  lastMessageAt: string
}

export type UserChatbotContextBooking = {
  id: string
  projectTitle: string
  dueDate?: string
  status: string
  originatedFrom?: string
  start?: string
  end?: string
}

export type UserChatbotContext = {
  userId: string
  recentConversations: UserChatbotContextConversation[]
  recentBookings: UserChatbotContextBooking[]
  knownProfile: {
    finalMediums: string[]
    jobTypes: string[]
    workSites: string[]
  }
  referenceUrls: string[]
}

export async function loadUserChatbotContext(input: {
  userId: string
  currentConversationId?: string
  maxConversations?: number
  maxBookings?: number
}): Promise<UserChatbotContext> {
  const maxConversations = limitCount(input.maxConversations, defaultMaxConversations)
  const maxBookings = limitCount(input.maxBookings, defaultMaxBookings)

  const [conversationRows, bookingRows] = await Promise.all([
    prisma.chatbotConversation.findMany({
      where: {
        userId: input.userId,
        ...(input.currentConversationId ? { id: { not: input.currentConversationId } } : {}),
      },
      orderBy: { lastMessageAt: "desc" },
      take: maxConversations,
      include: { inquiry: true },
    }),
    prisma.bookingGroup.findMany({
      where: { customer: { userId: input.userId } },
      orderBy: { updatedAt: "desc" },
      take: maxBookings,
      include: {
        timeSlots: {
          orderBy: { startTime: "asc" },
        },
      },
    }),
  ])

  const recentConversations = conversationRows.map(toContextConversation)

  return {
    userId: input.userId,
    recentConversations,
    recentBookings: bookingRows.map(toContextBooking),
    knownProfile: {
      finalMediums: uniqueDefined(recentConversations.map((conversation) => conversation.finalMedium)),
      jobTypes: uniqueDefined(recentConversations.map((conversation) => conversation.jobType)),
      workSites: uniqueDefined(recentConversations.map((conversation) => conversation.workSite)),
    },
    referenceUrls: uniqueDefined(conversationRows.flatMap((row) => parseStringArray(row.referenceUrls))),
  }
}

export function formatUserChatbotContextForPrompt(
  context: UserChatbotContext,
  maxCharacters = defaultMaxPromptCharacters,
): string {
  const mutableContext: UserChatbotContext = {
    ...context,
    recentConversations: [...context.recentConversations],
    recentBookings: [...context.recentBookings],
    knownProfile: {
      finalMediums: [...context.knownProfile.finalMediums],
      jobTypes: [...context.knownProfile.jobTypes],
      workSites: [...context.knownProfile.workSites],
    },
    referenceUrls: [...context.referenceUrls],
  }

  let prompt = buildPrompt(mutableContext)
  while (prompt.length > maxCharacters) {
    if (mutableContext.recentConversations.length > 0) {
      mutableContext.recentConversations.pop()
    } else if (mutableContext.recentBookings.length > 0) {
      mutableContext.recentBookings.pop()
    } else if (mutableContext.referenceUrls.length > 0) {
      mutableContext.referenceUrls.pop()
    } else {
      return prompt.slice(0, Math.max(0, maxCharacters))
    }
    prompt = buildPrompt(mutableContext)
  }

  return prompt
}

function buildPrompt(context: UserChatbotContext): string {
  const lines = [
    "本人文脈:",
    "- この情報はログイン中ユーザー本人に物理スコープされた過去情報です。他顧客の情報として扱える内容はありません。",
  ]

  if (
    context.recentConversations.length === 0 &&
    context.recentBookings.length === 0 &&
    context.referenceUrls.length === 0
  ) {
    lines.push("- 既存の本人文脈はありません。")
    return lines.join("\n")
  }

  if (
    context.knownProfile.finalMediums.length > 0 ||
    context.knownProfile.jobTypes.length > 0 ||
    context.knownProfile.workSites.length > 0
  ) {
    lines.push(
      `- 既知傾向: finalMedium=${joinOrNone(context.knownProfile.finalMediums)} / jobType=${joinOrNone(
        context.knownProfile.jobTypes,
      )} / workSite=${joinOrNone(context.knownProfile.workSites)}`,
    )
  }

  if (context.recentConversations.length > 0) {
    lines.push("- 直近会話:")
    for (const conversation of context.recentConversations) {
      lines.push(
        `  - ${joinOrNone([
          conversation.subject,
          conversation.finalMedium,
          conversation.jobType,
          conversation.workSite,
          conversation.publicReleaseDate,
          conversation.summaryText,
        ])}`,
      )
    }
  }

  if (context.recentBookings.length > 0) {
    lines.push("- 直近予約:")
    for (const booking of context.recentBookings) {
      lines.push(
        `  - ${joinOrNone([
          booking.projectTitle,
          booking.dueDate,
          booking.status,
          booking.originatedFrom,
          booking.start && booking.end ? `${booking.start} - ${booking.end}` : undefined,
        ])}`,
      )
    }
  }

  if (context.referenceUrls.length > 0) {
    lines.push(`- 参考URL: ${context.referenceUrls.join(", ")}`)
  }

  return lines.join("\n")
}

function toContextConversation(row: ConversationRow): UserChatbotContextConversation {
  return {
    id: row.id,
    subject: row.inquiry?.jobType ?? row.jobType ?? undefined,
    finalMedium: row.inquiry?.finalMedium ?? row.finalMedium ?? undefined,
    jobType: row.inquiry?.jobType ?? row.jobType ?? undefined,
    workSite: row.inquiry?.workSite ?? row.workSite ?? undefined,
    publicReleaseDate: row.inquiry?.desiredDeadline ?? undefined,
    summaryText: row.inquiry?.aiSummary ?? undefined,
    lastMessageAt: row.lastMessageAt.toISOString(),
  }
}

function toContextBooking(row: BookingRow): UserChatbotContextBooking {
  const firstSlot = row.timeSlots[0]

  return {
    id: row.id,
    projectTitle: row.projectTitle,
    dueDate: row.dueDate ?? undefined,
    status: row.status,
    originatedFrom: row.originatedFrom ?? undefined,
    start: firstSlot?.startTime.toISOString(),
    end: firstSlot?.endTime.toISOString(),
  }
}

function limitCount(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(Math.floor(value), fallback))
}

function parseStringArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function uniqueDefined(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function joinOrNone(values: Array<string | undefined>): string {
  const compact = values.filter((value): value is string => Boolean(value))
  return compact.length > 0 ? compact.join(" / ") : "none"
}
