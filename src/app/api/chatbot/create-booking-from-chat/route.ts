import { PUBLIC_CHATBOT_BOOKING_USER_EMAIL } from "@/lib/booking/server/claim-chat-bookings"
import { isCalendarDate, isValidDeadlineInput, todayInJapan } from "@/lib/chatbot/domain/deadline"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { respondInternalError } from "@/lib/api/server/error-response"
import {
  buildChatbotBookingAuditEvents,
  buildChatbotOperationFailureAuditEvent,
  describeFailureForAudit,
  type ChatbotMessageAuditEvidence,
} from "@/lib/chatbot/audit/server-evidence"
import { scheduleChatbotAuditPersistence } from "@/lib/chatbot/audit/scheduler"
import { isChatbotConversationOwnedBySession } from "@/lib/chatbot/audit/store"
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
import {
  buildChatbotSlackDeliveryEvidence,
  buildChatbotSlackDeliveryEvidenceItem,
  sendChatbotSlackNotification,
  type ChatbotSlackNotificationInput,
} from "@/lib/chatbot/server/slack-notifier"
import { getChatbotBuildSha } from "@/lib/chatbot/server/build-info"
import { jobContextSchema, workflowEstimateSchema } from "@/lib/chatbot/server/booking-request-schemas"
import { planChatbotWorkSchedule, type ChatbotWorkSchedule } from "@/lib/chatbot/server/work-schedule-plan"
import {
  chatbotSlackAuditErrorCode,
  isChatbotDiagnosticRequest,
  skipDiagnosticSlackNotification,
} from "@/lib/chatbot/server/diagnostic-request"
import { logPrivacySafeChatbotEvent } from "@/lib/chatbot/server/boundary-event-log"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const sessionCookieName = "chatbot_session_id"

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
    dueDate: z.string().refine((value) => isValidDeadlineInput(value)).optional(),
    memo: z.string().trim().max(2000).optional(),
    agreed: z.literal(true),
    selectedSlot: selectedSlotSchema.optional(),
    selectedSlots: z.array(selectedSlotSchema).optional(),
    // The attendance days the customer picked; the owner's work days are placed around them.
    attendanceDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(10).optional(),
    jobContext: z.unknown().optional(),
    workflowEstimate: z.unknown().optional(),
    correlationId: z.string().uuid().optional(),
  })



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

function toBookingApiInput(
  input: z.infer<typeof chatbotBookingRequestSchema>,
  requestedDates: string[] = [],
): BookingApiInput {
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
    requestedDates,
  }
}

async function planRequestedSchedule(
  input: z.infer<typeof chatbotBookingRequestSchema>,
): Promise<ChatbotWorkSchedule | null> {
  if (!input.attendanceDates?.length || normalizeSelectedSlots(input).length > 0) return null
  const jobContext = jobContextSchema.safeParse(input.jobContext)
  const workflowEstimate = workflowEstimateSchema.safeParse(input.workflowEstimate)
  if (!jobContext.success || !workflowEstimate.success) return null
  return planChatbotWorkSchedule({
    jobContext: jobContext.data,
    workflowEstimate: workflowEstimate.data,
    attendanceDates: input.attendanceDates,
    dueDate: input.dueDate,
  })
}

function bookingGroupIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const value = (body as { bookingGroupId?: unknown }).bookingGroupId
  return typeof value === "string" && value.trim() ? value : null
}

function isIdempotentReplayBody(body: unknown): boolean {
  return Boolean(
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    (body as { idempotentReplay?: unknown }).idempotentReplay === true,
  )
}

function bodyWithLinkWarning(body: unknown): unknown {
  return bodyWithWarning(body, "linkWarning", "chat_link_failed")
}

function bodyWithNotificationWarning(body: unknown, warning: "skipped" | "send_failed"): unknown {
  return bodyWithWarning(body, "ownerNotificationWarning", warning)
}

function bodyWithEmailDebug(body: unknown, key: string, id: string | null): unknown {
  const isLocalDevelopment =
    process.env.NODE_ENV === "development" &&
    process.env.VERCEL !== "1" &&
    (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === "development")
  if (!isLocalDevelopment) return body
  if (!body || typeof body !== "object" || Array.isArray(body)) return body
  const current = (body as { emailDebug?: unknown }).emailDebug
  return {
    ...body,
    emailDebug: {
      ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}),
      [key]: id,
    },
  }
}

function bodyWithWarning(body: unknown, key: string, value: string): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body
  return {
    ...body,
    [key]: value,
  }
}

async function notifyOwner(
  input: z.infer<typeof chatbotBookingRequestSchema>,
  bookingGroupId: string,
  schedule: ChatbotWorkSchedule | null,
) {
  const selectedSlots = normalizeSelectedSlots(input)
  try {
    const result = await sendChatbotBookingOwnerNotification({
      ...(schedule
        ? { requestedDates: schedule.days.map((day) => day.date), scheduleLines: schedule.lines }
        : {}),
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
      return { warning: "skipped" as const, id: null }
    }

    return { warning: null, id: result.id }
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
    return { warning: "send_failed" as const, id: null }
  }
}

async function notifySlackBookingOrderSubmitted(input: {
  requestId: string
  request: z.infer<typeof chatbotBookingRequestSchema>
  bookingGroupId: string
  selectedSlotCount: number
  ownerNotificationWarning: "skipped" | "send_failed" | null
  notifier: typeof sendChatbotSlackNotification
}): Promise<ChatbotMessageAuditEvidence["slack"]> {
  if (!input.request.conversationId) return { result: "failure", errorCode: "slack-no-conversation" }

  try {
    const conversation = await loadConversationById(input.request.conversationId)
    const threadTs = conversation?.context.slackThreadTs
    const notificationInput = {
      kind: "booking-order-submitted",
      requestId: input.requestId,
      conversationId: input.request.conversationId,
      sessionId: conversation?.context.sessionId,
      threadTs,
      bookingGroupId: input.bookingGroupId,
      selectedSlotCount: input.selectedSlotCount,
    } as const
    const result = await input.notifier(notificationInput)
    const deliveries = [buildChatbotSlackDeliveryEvidenceItem(notificationInput, result)]
    let auditResult: ChatbotMessageAuditEvidence["slack"] = result.status === "sent"
      ? { result: "success", deliveryEvidence: buildChatbotSlackDeliveryEvidence(deliveries) }
      : {
          result: "failure",
          errorCode: chatbotSlackAuditErrorCode(result),
          deliveryEvidence: buildChatbotSlackDeliveryEvidence(deliveries),
        }

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
      const issueInput: ChatbotSlackNotificationInput = {
        kind: "issue",
        requestId: input.requestId,
        conversationId: input.request.conversationId,
        sessionId: conversation?.context.sessionId,
        threadTs: savedThreadTs,
        bookingGroupId: input.bookingGroupId,
        issueReasons: ["booking-owner-email-send-failed"],
      }
      const issueResult = await input.notifier(issueInput)
      deliveries.push(buildChatbotSlackDeliveryEvidenceItem(issueInput, issueResult))
      auditResult.deliveryEvidence = buildChatbotSlackDeliveryEvidence(deliveries)
      if (issueResult.status !== "sent") {
        auditResult = { result: "failure", errorCode: chatbotSlackAuditErrorCode(issueResult) }
      }
    }
    return auditResult
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
    return { result: "failure", errorCode: "slack-exception" }
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
  const deadline = parsed.data.dueDate
  if (deadline && isCalendarDate(deadline) && (
    parsed.data.attendanceDates?.some((date) => date > deadline) ||
    normalizeSelectedSlots(parsed.data).some((slot) => todayInJapan(new Date(new Date(slot.end).getTime() - 1)) > deadline)
  )) {
    return NextResponse.json({ error: "attendance_after_deadline" }, { status: 400 })
  }
  const requestId = parsed.data.correlationId ?? crypto.randomUUID()
  const bookingStartedAt = Date.now()

  if (parsed.data.conversationId) {
    const cookieSessionId = request.cookies.get(sessionCookieName)?.value
    if (!cookieSessionId) {
      return NextResponse.json({ error: "missing_chatbot_session" }, { status: 401 })
    }
    const conversation = await loadConversationById(parsed.data.conversationId)
    if (!conversation) {
      return NextResponse.json({ error: "conversation_not_found" }, { status: 404 })
    }
    if (!isChatbotConversationOwnedBySession({
      conversationSessionId: conversation.context.sessionId,
      cookieSessionId,
    })) {
      return NextResponse.json({ error: "conversation_not_owned" }, { status: 403 })
    }
  }

  let schedule: ChatbotWorkSchedule | null = null
  try {
    schedule = await planRequestedSchedule(parsed.data)
  } catch (error) {
    // Without a placed schedule the booking still goes through, with the attendance days alone.
    logPrivacySafeChatbotEvent({
      event: "chatbot_booking_schedule_plan_failed",
      requestId,
      errorKind: error instanceof Error ? error.name : typeof error,
    })
  }
  const requestedDates = schedule
    ? schedule.days.map((day) => day.date)
    : normalizeSelectedSlots(parsed.data).length === 0 ? parsed.data.attendanceDates ?? [] : []

  let input: BookingApiInput
  try {
    input = toBookingApiInput(parsed.data, requestedDates)
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
    const session = await auth()
    const userId = session?.user?.id ?? await getPublicChatbotBookingUserId()
    const userEmail = parsed.data.contactEmail
    const result = await createBookingFromApiInput({
      input,
      notionTaskType: "仮押さえ",
      originatedFrom: "chatbot",
      idempotencyKey: requestId,
      userId,
      userEmail,
      ...(schedule ? { requestedDateLabels: schedule.dateLabels, scheduleLines: schedule.lines } : {}),
    })
    const bookingGroupId = bookingGroupIdFromBody(result.body)
    const idempotentReplay = isIdempotentReplayBody(result.body)
    const selectedSlotCount = normalizeSelectedSlots(parsed.data).length
    let responseBody = result.body
    let notificationWarning: "skipped" | "send_failed" | null = null
    let conversationLinked = false
    let slackAudit: ChatbotMessageAuditEvidence["slack"] = {
      result: "failure",
      errorCode: "slack-not-attempted",
    }
    if (result.status >= 200 && result.status < 300 && bookingGroupId && !idempotentReplay) {
      const ownerNotification = await notifyOwner(parsed.data, bookingGroupId, schedule)
      notificationWarning = ownerNotification.warning
      responseBody = bodyWithEmailDebug(responseBody, "chatbotOwnerNotificationId", ownerNotification.id)
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
        conversationLinked = true
      } catch (error) {
        logPrivacySafeChatbotEvent({
          event: "chatbot_booking_link_failed",
          requestId,
          errorKind: error instanceof Error ? error.name : typeof error,
        })
        responseBody = bodyWithLinkWarning(responseBody)
      }
    }

    if (result.status >= 200 && result.status < 300 && bookingGroupId && !idempotentReplay) {
      slackAudit = await notifySlackBookingOrderSubmitted({
        requestId,
        request: parsed.data,
        bookingGroupId,
        selectedSlotCount,
        ownerNotificationWarning: notificationWarning,
        // Automated checks keep their bookings out of Slack; manual tests and customers still post.
        notifier: isChatbotDiagnosticRequest(request.headers)
          ? skipDiagnosticSlackNotification
          : sendChatbotSlackNotification,
      })
    } else if (idempotentReplay) {
      slackAudit = {
        result: "failure",
        errorCode: "idempotent-replay-notification-not-repeated",
      }
    }

    if (parsed.data.conversationId && bookingGroupId) {
      scheduleChatbotAuditPersistence(buildChatbotBookingAuditEvents({
        requestId,
        conversationId: parsed.data.conversationId,
        buildSha: getChatbotBuildSha(),
        createdAt: new Date().toISOString(),
        bookingCreated: result.status >= 200 && result.status < 300,
        customerAuthenticated: Boolean(session?.user?.id),
        customerAccountLinked: Boolean(session?.user?.id && conversationLinked),
        slack: slackAudit,
        durationMs: Date.now() - bookingStartedAt,
      }))
    }

    return NextResponse.json(bodyWithWarning(responseBody, "requestId", requestId), {
      status: result.status,
      headers: result.headers,
    })
  } catch (error) {
    if (error instanceof BookingConflictError) {
      if (parsed.data.conversationId) {
        scheduleChatbotAuditPersistence([buildChatbotOperationFailureAuditEvent({
          requestId,
          conversationId: parsed.data.conversationId,
          buildSha: getChatbotBuildSha(),
          createdAt: new Date().toISOString(),
          errorCode: "booking-conflict",
          durationMs: Date.now() - bookingStartedAt,
        })])
      }
      return NextResponse.json({ error: error.message, requestId }, { status: 409 })
    }
    if (parsed.data.conversationId) {
      scheduleChatbotAuditPersistence([buildChatbotOperationFailureAuditEvent({
        requestId,
        conversationId: parsed.data.conversationId,
        buildSha: getChatbotBuildSha(),
        createdAt: new Date().toISOString(),
        errorCode: "booking-save-failed",
        errorReason: describeFailureForAudit(error),
        durationMs: Date.now() - bookingStartedAt,
      })])
    }
    return respondChatbotOperationFailure({
      operation: "create-booking-from-chat",
      requestId,
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
