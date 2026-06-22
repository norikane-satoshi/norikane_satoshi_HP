import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { respondInternalError } from "@/lib/api/server/error-response"
import { bookingApiSchema, type BookingApiInput } from "@/lib/booking/domain/api-schema"
import { bookingFormSchema } from "@/lib/booking/domain/form-schema"
import { createBookingFromApiInput } from "@/lib/booking/server/create-booking"
import { sendChatbotBookingOwnerNotification } from "@/lib/booking/server/email"
import { BookingConflictError } from "@/lib/booking/server/errors"
import {
  logChatbotOperationFailure,
  respondChatbotOperationFailure,
} from "@/lib/chatbot/server/operation-failure"
import {
  linkChatToBookingGroup,
  loadConversationById,
  updateConversationSlackThreadTs,
} from "@/lib/chatbot/server/repository"
import { sendChatbotSlackNotification } from "@/lib/chatbot/server/slack-notifier"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const selectedSlotSchema = z
  .object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  })
  .superRefine((value, context) => {
    const start = new Date(value.start)
    const end = new Date(value.end)
    if (start >= end) {
      context.addIssue({
        code: "custom",
        message: "終了時刻は開始時刻より後にしてください",
        path: ["end"],
      })
    }
  })

const chatbotBookingRequestSchema = z
  .object({
    conversationId: z.string().trim().min(1).optional(),
    projectTitle: z.string().trim().min(1).max(200),
    contactName: z.string().trim().min(1).max(80),
    contactEmail: z.string().trim().email().max(254),
    companyName: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(32).optional(),
    dueDate: z.string().optional(),
    memo: z.string().trim().max(2000).optional(),
    agreed: z.literal(true),
    selectedSlot: selectedSlotSchema.optional(),
    selectedSlots: z.array(selectedSlotSchema).optional(),
    jobContext: z.unknown().optional(),
    workflowEstimate: z.unknown().optional(),
  })

const PUBLIC_CHATBOT_BOOKING_USER_EMAIL = "chatbot-booking@norikane.studio"

async function getPublicChatbotBookingUserId(): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email: PUBLIC_CHATBOT_BOOKING_USER_EMAIL },
    update: { name: "Chatbot Public Booking" },
    create: {
      email: PUBLIC_CHATBOT_BOOKING_USER_EMAIL,
      name: "Chatbot Public Booking",
    },
    select: { id: true },
  })

  return user.id
}

function normalizeSelectedSlots(input: z.infer<typeof chatbotBookingRequestSchema>) {
  return input.selectedSlots?.length ? input.selectedSlots : input.selectedSlot ? [input.selectedSlot] : []
}

function toBookingApiInput(input: z.infer<typeof chatbotBookingRequestSchema>): BookingApiInput {
  const selectedSlots = normalizeSelectedSlots(input)
  const baseInput = {
    projectTitle: input.projectTitle,
    dueDate: input.dueDate ?? "",
    companyName: input.companyName ?? "",
    contactName: input.contactName,
    sessionEmail: input.contactEmail,
    phone: input.phone ?? "",
    memo: input.memo ?? "",
    agreed: input.agreed,
  }

  if (selectedSlots.length > 0) {
    return bookingApiSchema.parse({
      ...baseInput,
      selectedSlots,
    })
  }

  return {
    ...bookingFormSchema.parse(baseInput),
    selectedSlots: [],
  }
}

function bookingGroupIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const value = (body as { bookingGroupId?: unknown }).bookingGroupId
  return typeof value === "string" && value.trim() ? value : null
}

function bodyWithLinkWarning(body: unknown): unknown {
  return bodyWithWarning(body, "linkWarning", "chat_link_failed")
}

function bodyWithNotificationWarning(body: unknown, warning: "skipped" | "send_failed"): unknown {
  return bodyWithWarning(body, "ownerNotificationWarning", warning)
}

function bodyWithWarning(body: unknown, key: string, value: string): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body
  return {
    ...body,
    [key]: value,
  }
}

async function notifyOwner(input: z.infer<typeof chatbotBookingRequestSchema>, bookingGroupId: string) {
  const selectedSlots = normalizeSelectedSlots(input)
  try {
    const result = await sendChatbotBookingOwnerNotification({
      bookingGroupId,
      projectTitle: input.projectTitle,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      companyName: input.companyName,
      memo: input.memo,
      selectedSlots,
      submittedAt: new Date(),
    })

    if (result.skipped) {
      logChatbotOperationFailure({
        operation: "create-booking-from-chat",
        stage: "notification-send",
        status: 202,
        error: new Error("chatbot_booking_owner_notification_skipped_missing_resend_api_key"),
        requestSummary: {
          bookingGroupId,
          conversationId: input.conversationId,
          selectedSlotCount: selectedSlots.length,
        },
      })
      return "skipped" as const
    }

    return null
  } catch (error) {
    logChatbotOperationFailure({
      operation: "create-booking-from-chat",
      stage: "notification-send",
      status: 202,
      error,
      requestSummary: {
        bookingGroupId,
        conversationId: input.conversationId,
        selectedSlotCount: selectedSlots.length,
      },
    })
    return "send_failed" as const
  }
}

async function notifySlackBookingCompleted(input: {
  request: z.infer<typeof chatbotBookingRequestSchema>
  bookingGroupId: string
  selectedSlotCount: number
  ownerNotificationWarning: "skipped" | "send_failed" | null
}): Promise<void> {
  if (!input.request.conversationId) return

  try {
    const conversation = await loadConversationById(input.request.conversationId)
    const threadTs = conversation?.context.slackThreadTs
    const result = await sendChatbotSlackNotification({
      kind: "booking-completed",
      conversationId: input.request.conversationId,
      sessionId: conversation?.context.sessionId,
      threadTs,
      bookingGroupId: input.bookingGroupId,
      selectedSlotCount: input.selectedSlotCount,
    })

    const savedThreadTs = threadTs ?? (result.status === "sent" ? result.ts : null)
    if (!threadTs && savedThreadTs) {
      await updateConversationSlackThreadTs({
        conversationId: input.request.conversationId,
        slackThreadTs: savedThreadTs,
      })
    }

    if (result.status === "failed") {
      logChatbotOperationFailure({
        operation: "create-booking-from-chat",
        stage: "notification-send",
        status: 202,
        error: new Error("chatbot_slack_booking_notification_failed"),
        requestSummary: {
          bookingGroupId: input.bookingGroupId,
          conversationId: input.request.conversationId,
          selectedSlotCount: input.selectedSlotCount,
        },
      })
    }

    if (input.ownerNotificationWarning === "send_failed" && savedThreadTs) {
      await sendChatbotSlackNotification({
        kind: "issue",
        conversationId: input.request.conversationId,
        sessionId: conversation?.context.sessionId,
        threadTs: savedThreadTs,
        bookingGroupId: input.bookingGroupId,
        issueReasons: ["booking-owner-email-send-failed"],
      })
    }
  } catch (error) {
    logChatbotOperationFailure({
      operation: "create-booking-from-chat",
      stage: "notification-send",
      status: 202,
      error,
      requestSummary: {
        bookingGroupId: input.bookingGroupId,
        conversationId: input.request.conversationId,
        selectedSlotCount: input.selectedSlotCount,
      },
    })
  }
}

export async function POST(request: NextRequest) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const parsed = chatbotBookingRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  let input: BookingApiInput
  try {
    input = toBookingApiInput(parsed.data)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "invalid_request",
          issues: error.issues,
        },
        { status: 400 },
      )
    }
    return respondInternalError(error, "chatbot.create-booking-from-chat.parse")
  }

  try {
    const userId = await getPublicChatbotBookingUserId()
    const userEmail = parsed.data.contactEmail
    const result = await createBookingFromApiInput({ input, userId, userEmail })
    const bookingGroupId = bookingGroupIdFromBody(result.body)
    const selectedSlotCount = normalizeSelectedSlots(parsed.data).length
    let responseBody = result.body
    let notificationWarning: "skipped" | "send_failed" | null = null
    if (result.status >= 200 && result.status < 300 && bookingGroupId) {
      notificationWarning = await notifyOwner(parsed.data, bookingGroupId)
      if (notificationWarning) {
        responseBody = bodyWithNotificationWarning(responseBody, notificationWarning)
      }
    }

    if (result.status >= 200 && result.status < 300 && bookingGroupId && parsed.data.conversationId) {
      try {
        await linkChatToBookingGroup({
          conversationId: parsed.data.conversationId,
          bookingGroupId,
        })
      } catch (error) {
        console.warn("Chatbot booking link failed", {
          bookingGroupId,
          error: error instanceof Error ? error.message : String(error),
        })
        return NextResponse.json(bodyWithLinkWarning(responseBody), {
          status: result.status,
          headers: result.headers,
        })
      }
    }

    if (result.status >= 200 && result.status < 300 && bookingGroupId) {
      await notifySlackBookingCompleted({
        request: parsed.data,
        bookingGroupId,
        selectedSlotCount,
        ownerNotificationWarning: notificationWarning,
      })
    }

    return NextResponse.json(responseBody, { status: result.status, headers: result.headers })
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return respondChatbotOperationFailure({
      operation: "create-booking-from-chat",
      stage: "booking-save",
      error,
      requestSummary: {
        conversationId: parsed.data.conversationId,
        selectedSlotCount: normalizeSelectedSlots(parsed.data).length,
        hasWorkflowEstimate: Boolean(parsed.data.workflowEstimate),
      },
    })
  }
}
