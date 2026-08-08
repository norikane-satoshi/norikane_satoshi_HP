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
import { linkChatToBookingGroup, loadConversationById } from "@/lib/chatbot/server/repository"
import { notifyChatbotSlack, type ChatbotSlackProblem } from "@/lib/chatbot/server/slack-notification"
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
    let responseBody = result.body
    if (result.status >= 200 && result.status < 300 && bookingGroupId) {
      const notificationWarning = await notifyOwner(parsed.data, bookingGroupId)
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
        await notifyBookingSlackSafely({
          conversationId: parsed.data.conversationId,
          bookingGroupId,
          bookingStatus: readStringField(responseBody, "bookingStatus") ?? readStringField(responseBody, "status"),
          projectTitle: parsed.data.projectTitle,
          contactEmail: parsed.data.contactEmail,
          problems: [{ code: "booking-order-failed", reason: "Booking was created but chat conversation link failed." }],
          includeCompletedProblem: true,
        })
        return NextResponse.json(bodyWithLinkWarning(responseBody), {
          status: result.status,
          headers: result.headers,
        })
      }
    }

    if (result.status >= 200 && result.status < 300 && bookingGroupId && parsed.data.conversationId) {
      await notifyBookingSlackSafely({
        conversationId: parsed.data.conversationId,
        bookingGroupId,
        bookingStatus: readStringField(responseBody, "bookingStatus") ?? readStringField(responseBody, "status"),
        projectTitle: parsed.data.projectTitle,
        contactEmail: parsed.data.contactEmail,
        includeCompletedProblem: true,
        problems: responseHasOwnerNotificationWarning(responseBody)
          ? [{ code: "email-send-failed", reason: "Booking owner email notification failed or was skipped." }]
          : [],
      })
    }

    return NextResponse.json(responseBody, { status: result.status, headers: result.headers })
  } catch (error) {
    if (error instanceof BookingConflictError) {
      await notifyBookingProblemSlackSafely(parsed.data.conversationId, {
        code: "booking-order-failed",
        reason: "Booking slot conflict.",
      })
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    await notifyBookingProblemSlackSafely(parsed.data.conversationId, {
      code: "booking-order-failed",
      reason: error instanceof Error ? error.message : "booking-save failed.",
    })
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

async function notifyBookingSlackSafely(input: {
  conversationId: string
  bookingGroupId: string
  bookingStatus?: string | null
  projectTitle: string
  contactEmail: string
  problems: ChatbotSlackProblem[]
  includeCompletedProblem?: boolean
}): Promise<void> {
  try {
    const conversation = await loadConversationById(input.conversationId)
    const result = await notifyChatbotSlack({
      kind: "booking-order",
      conversationId: input.conversationId,
      sessionId: conversation?.context.sessionId,
      bookingGroupId: input.bookingGroupId,
      bookingStatus: input.bookingStatus ?? undefined,
      projectTitle: input.projectTitle,
      contactEmail: input.contactEmail,
      problems: [
        ...(input.includeCompletedProblem
          ? [{ code: "booking-order-completed" as const, reason: "Booking Order was submitted from chatbot." }]
          : []),
        ...input.problems,
      ],
    })
    if (result.status === "failed") {
      console.warn("[chatbot slack notification warning]", {
        conversationId: input.conversationId,
        reason: result.reason,
      })
    }
  } catch (error) {
    console.warn("[chatbot slack notification warning]", {
      conversationId: input.conversationId,
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}

async function notifyBookingProblemSlackSafely(
  conversationId: string | undefined,
  problem: ChatbotSlackProblem,
): Promise<void> {
  if (!conversationId) return
  await notifyBookingSlackSafely({
    conversationId,
    bookingGroupId: "-",
    projectTitle: "-",
    contactEmail: "-",
    problems: [problem],
  })
}

function responseHasOwnerNotificationWarning(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false
  return "ownerNotificationWarning" in body
}

function readStringField(body: unknown, key: string): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const value = (body as Record<string, unknown>)[key]
  return typeof value === "string" ? value : null
}
