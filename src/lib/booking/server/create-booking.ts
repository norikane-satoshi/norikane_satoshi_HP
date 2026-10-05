import type { BookingApiInput } from "@/lib/booking/domain/api-schema"
import { resolveConflictForFinalSubmit } from "@/lib/booking/domain/conflicts"
import {
  bookingDateRangeToSelection,
  formatBookingDateSelection,
  type BookingDateSelection,
} from "@/lib/booking/domain/form-schema"
import { invalidateCalendarFreeBusyCacheForUser } from "@/lib/booking/server/calendar-free-busy/free-busy"
import { findConflictingBookings } from "@/lib/booking/server/conflicts"
import { BookingConflictError } from "@/lib/booking/server/errors"
import {
  allCalendarEventSyncsSucceeded,
  buildRequestedDateCalendarEventIntents,
  persistCalendarEventIntents,
  syncBookingGroupCalendarEvents,
  type BookingCalendarEventIntent,
} from "@/lib/booking/server/calendar-event-lifecycle"
import {
  sendBookingConfirmedEmail,
  type BookingEmailArgs,
} from "@/lib/booking/server/email"
import {
  CALENDAR_TOKEN_USER_ID,
  refreshCalendarAccessToken,
  type CalendarEventWriteInput,
} from "@/lib/google-calendar/server"
import { sendLineBookingReceipt } from "@/lib/line/messaging"
import { prisma } from "@/lib/prisma"
import { logPrivacySafeChatbotEvent } from "@/lib/chatbot/server/boundary-event-log"

export type CreateBookingResult = {
  body: unknown
  status: number
  headers?: HeadersInit
}

type CreateBookingFromApiInputArgs = {
  input: BookingApiInput
  notionTaskType?: CalendarEventWriteInput["notionTaskType"]
  originatedFrom?: "web" | "line_liff" | "chatbot"
  idempotencyKey?: string
  userId: string
  userEmail: string | null
  /** What each requested date holds, for a chat booking whose owner work days were placed around the attendance. */
  requestedDateLabels?: Record<string, string>
}

function nullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

function createDescription(input: BookingApiInput): string {
  const fields = [
    ["候補日", getScheduleLabel(input)],
    ["案件名", input.projectTitle],
    ["納期", input.dueDate],
    ["会社名", input.companyName],
    ["氏名", input.contactName],
    ["メール", input.sessionEmail],
    ["TEL", input.phone],
    ["補足", input.memo],
  ].map(([label, value]) => `${label}: ${value.trim() || "-"}`)
  return fields.join("\n")
}

function createSummary(input: BookingApiInput): string {
  return `【仮キープ】${input.projectTitle} / ${input.contactName}`
}

function createBookingEmailArgs(
  input: BookingApiInput,
  to: string,
  bookingGroupId: string,
): BookingEmailArgs {
  return {
    to,
    projectTitle: input.projectTitle,
    selectedSlots: input.selectedSlots,
    requestedDates: getRequestedDateSelection(input)?.dates,
    bookingGroupId,
    workScopes: [],
    memo: input.memo,
    estimatedDuration: "consult",
  }
}

function getRequestedDateSelection(input: BookingApiInput): BookingDateSelection | null {
  if ((input.requestedDates ?? []).length > 0) return { dates: input.requestedDates }
  if (input.requestedDateRange) return bookingDateRangeToSelection(input.requestedDateRange)
  return null
}

function getScheduleLabel(input: BookingApiInput): string {
  if (input.selectedSlots.length > 0) {
    return input.selectedSlots.map((slot) => `${slot.start} - ${slot.end}`).join(" / ")
  }
  const requestedDateSelection = getRequestedDateSelection(input)
  return requestedDateSelection ? formatBookingDateSelection(requestedDateSelection) : "未定（日程は則兼と相談）"
}

async function warnOnEmailFailure(task: Promise<unknown>, tag: string) {
  try {
    await task
  } catch (error) {
    logPrivacySafeChatbotEvent({
      event: "booking_customer_email_failed",
      tag,
      errorCode: operationalErrorCode(error),
    })
  }
}

async function sendTentativeHoldEmail(
  input: BookingApiInput,
  to: string | null,
  bookingGroupId: string,
) {
  if (!to) return
  await warnOnEmailFailure(
    sendBookingConfirmedEmail(createBookingEmailArgs(input, to, bookingGroupId)),
    "tentative_hold",
  )
}

async function sendCustomerReceipt(
  input: BookingApiInput,
  to: string | null,
  bookingGroupId: string,
  scheduleLabel: string,
) {
  if (input.entryPoint === "line_liff" && input.lineUserId) {
    const result = await sendLineBookingReceipt({
      bookingGroupId,
      lineUserId: input.lineUserId,
      replyToken: input.lineReplyToken,
      projectTitle: input.projectTitle,
      scheduleLabel,
    })
    if (!result.ok) {
      logPrivacySafeChatbotEvent({
        event: "booking_line_receipt_failed",
        method: result.method,
        status: result.status,
        errorCode: "line_receipt_failed",
      })
    }
    return
  }

  await sendTentativeHoldEmail(input, to, bookingGroupId)
}

async function refreshStoredCalendarToken() {
  const storedToken = await prisma.calendarToken.findUnique({
    where: { userId: CALENDAR_TOKEN_USER_ID },
  })

  if (!storedToken) throw new Error("Google Calendar token is not connected")

  const refreshed = await refreshCalendarAccessToken(storedToken.refreshToken)
  await prisma.calendarToken.update({
    where: { userId: CALENDAR_TOKEN_USER_ID },
    data: {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope,
    },
  })

  return refreshed.accessToken
}

function sanitizeGcalEventId(id: string): string {
  return id.toLowerCase().replace(/[^a-v0-9]/g, "")
}

function operationalErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = error.code
    if (typeof code === "string" && /^[a-z0-9][a-z0-9_.:-]{0,119}$/i.test(code)) return code
  }
  if (error instanceof Error && /^[a-z0-9][a-z0-9_.:-]{0,119}$/i.test(error.name)) {
    return error.name
  }
  return "unknown_error"
}

export async function createBookingFromApiInput({
  input,
  notionTaskType,
  originatedFrom,
  idempotencyKey,
  userId,
  userEmail,
  requestedDateLabels,
}: CreateBookingFromApiInputArgs): Promise<CreateBookingResult> {
  const slots = input.selectedSlots
  const primarySlot = slots[0]
  const hasSelectedSlots = slots.length > 0
  const scheduleLabel = getScheduleLabel(input)
  const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
  const teamId = input.teamId ?? null
  const requestedDateSelection = hasSelectedSlots ? null : getRequestedDateSelection(input)
  const storedMemo = [originatedFrom === "chatbot" || !hasSelectedSlots ? `希望日: ${scheduleLabel}` : undefined, input.memo]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n")

  if (idempotencyKey) {
    const existing = await prisma.bookingGroup.findUnique({
      where: { chatbotIdempotencyKey: idempotencyKey },
      include: { timeSlots: true, calendarEvents: true },
    })
    if (existing) return existingIdempotentBookingResult(existing, calendarId)
  }

  const customer = await prisma.customer.upsert({
    where: { userId },
    update: {
      displayName: input.contactName,
      phone: nullable(input.phone),
      companyName: nullable(input.companyName),
      notes: nullable(storedMemo),
    },
    create: {
      userId,
      displayName: input.contactName,
      phone: nullable(input.phone),
      companyName: nullable(input.companyName),
      notes: nullable(storedMemo),
    },
  })

  let bookingGroup: { id: string; timeSlots: Array<{ id: string }> }
  try {
    bookingGroup = await prisma.$transaction(async (tx) => {
      const conflictLists = []
      for (const slot of slots) {
        conflictLists.push(
          await findConflictingBookings(new Date(slot.start), new Date(slot.end), {}, tx),
        )
      }
      const conflicts = conflictLists.flat()
      const conflict = resolveConflictForFinalSubmit(conflicts)
      if (conflict) throw new BookingConflictError(conflict)

      const created = await tx.bookingGroup.create({
        data: {
          customerId: customer.id,
          teamId,
          status: hasSelectedSlots ? "PENDING_GCAL" : "NEEDS_SCHEDULE",
          pendingExpiresAt: hasSelectedSlots ? new Date(Date.now() + 60_000) : null,
          projectTitle: input.projectTitle,
          memo: nullable(storedMemo),
          contactName: input.contactName,
          companyName: nullable(input.companyName),
          customerEmail: userEmail,
          phone: nullable(input.phone),
          dueDate: nullable(input.dueDate),
          originatedFrom: originatedFrom ?? input.entryPoint ?? "web",
          lineUserId: input.entryPoint === "line_liff" ? input.lineUserId ?? null : null,
          chatbotIdempotencyKey: idempotencyKey ?? null,
          timeSlots: {
            create: slots.map((slot) => ({
              startTime: new Date(slot.start),
              endTime: new Date(slot.end),
              status: "PENDING_GCAL",
            })),
          },
        },
        include: { timeSlots: true },
      })
      const baseEventId = sanitizeGcalEventId(created.id)
      const calendarEventIntents: BookingCalendarEventIntent[] = hasSelectedSlots
        ? [{
            eventId: baseEventId,
            startValue: primarySlot.start,
            endValue: primarySlot.end,
            dateOnly: false,
            summary: createSummary(input),
            description: createDescription(input),
            colorId: "9",
            notionTaskType: notionTaskType ?? "仮押さえ",
          }]
        : (requestedDateSelection?.dates.length
            ? buildRequestedDateCalendarEventIntents({
                bookingGroupId: created.id,
                dates: requestedDateSelection.dates,
                summary: createSummary(input),
                description: createDescription(input),
                notionTaskType: notionTaskType ?? "仮押さえ",
                ...(requestedDateLabels ? { dateLabels: requestedDateLabels } : {}),
              })
            : [])
      await persistCalendarEventIntents(tx, created.id, calendarEventIntents)
      return created
    }, { maxWait: 5000, timeout: 10000 })
  } catch (error) {
    if (!idempotencyKey || !isUniqueConstraintViolation(error)) throw error
    const existing = await prisma.bookingGroup.findUnique({
      where: { chatbotIdempotencyKey: idempotencyKey },
      include: { timeSlots: true, calendarEvents: true },
    })
    if (!existing) throw error
    return existingIdempotentBookingResult(existing, calendarId)
  }

  const bookingIds = bookingGroup.timeSlots.map((slot) => slot.id)

  const confirmBooking = async (gcalEventId?: string | null) => {
    await prisma.bookingGroup.update({
      where: { id: bookingGroup.id },
      data: {
        status: "CONFIRMED",
        gcalEventId,
        pendingExpiresAt: null,
      },
    })
    await prisma.bookingTimeSlot.updateMany({
      where: { bookingGroupId: bookingGroup.id },
      data: { status: "CONFIRMED" },
    })
  }

  if (!hasSelectedSlots) {
    if (!calendarId || !requestedDateSelection?.dates.length) {
      await sendCustomerReceipt(input, userEmail, bookingGroup.id, scheduleLabel)
      return {
        body: {
          status: "schedule_unselected",
          bookingGroupId: bookingGroup.id,
          bookingIds,
          bookingStatus: "NEEDS_SCHEDULE",
          scheduleStatus: "unscheduled",
          scheduleLabel,
          ...(!calendarId ? { gcalError: "GOOGLE_CALENDAR_BUSY_SOURCE_ID is not set" } : {}),
        },
        status: calendarId ? 200 : 207,
      }
    }

    try {
      const accessToken = await refreshStoredCalendarToken()
      const results = await syncBookingGroupCalendarEvents({ bookingGroupId: bookingGroup.id, calendarId, accessToken })
      const primaryEventId = results.find((result) => result.ok)?.eventId ?? null
      await prisma.bookingGroup.update({
        where: { id: bookingGroup.id },
        data: {
          gcalEventId: primaryEventId,
          pendingExpiresAt: allCalendarEventSyncsSucceeded(results) ? null : new Date(Date.now() + 60_000),
        },
      })
      if (!allCalendarEventSyncsSucceeded(results)) {
        await sendCustomerReceipt(input, userEmail, bookingGroup.id, scheduleLabel)
        return {
          body: {
            status: "pending_reconcile",
            bookingGroupId: bookingGroup.id,
            bookingIds,
            bookingStatus: "NEEDS_SCHEDULE",
            scheduleStatus: "processing",
            scheduleLabel,
          },
          status: 202,
          headers: { "Retry-After": "60" },
        }
      }
    } catch (error) {
      logPrivacySafeChatbotEvent({
        event: "booking_calendar_write_failed",
        dateOnly: true,
        errorCode: operationalErrorCode(error),
      })
      await prisma.bookingGroup.update({
        where: { id: bookingGroup.id },
        data: { pendingExpiresAt: new Date(Date.now() + 60_000) },
      })

      return {
        body: {
          status: "pending_reconcile",
          bookingGroupId: bookingGroup.id,
          bookingIds,
          bookingStatus: "NEEDS_SCHEDULE",
          scheduleStatus: "processing",
          scheduleLabel,
        },
        status: 202,
        headers: { "Retry-After": "60" },
      }
    }

    await sendCustomerReceipt(input, userEmail, bookingGroup.id, scheduleLabel)
    return {
      body: {
        status: "schedule_unselected",
        bookingGroupId: bookingGroup.id,
        bookingIds,
        bookingStatus: "NEEDS_SCHEDULE",
        scheduleStatus: "unscheduled",
        scheduleLabel,
      },
      status: 200,
    }
  }

  if (!calendarId) {
    await confirmBooking(null)
    invalidateCalendarFreeBusyCacheForUser(userId, teamId)
    await sendCustomerReceipt(input, userEmail, bookingGroup.id, scheduleLabel)
    logPrivacySafeChatbotEvent({
      event: "booking_calendar_write_skipped",
      reason: "missing_calendar_id",
    })
    return {
      body: {
        status: "ok_with_warning",
        bookingGroupId: bookingGroup.id,
        bookingIds,
        bookingStatus: "CONFIRMED",
        gcalError: "GOOGLE_CALENDAR_BUSY_SOURCE_ID is not set",
      },
      status: 207,
    }
  }

  let gcalEventId: string | null
  try {
    const accessToken = await refreshStoredCalendarToken()
    const results = await syncBookingGroupCalendarEvents({ bookingGroupId: bookingGroup.id, calendarId, accessToken })
    gcalEventId = results.find((result) => result.ok)?.eventId ?? null
    if (!allCalendarEventSyncsSucceeded(results)) {
      return {
        body: { status: "pending_reconcile", bookingGroupId: bookingGroup.id, gcalEventId },
        status: 202,
        headers: { "Retry-After": "60" },
      }
    }
  } catch (error) {
    logPrivacySafeChatbotEvent({
      event: "booking_calendar_write_failed",
      dateOnly: false,
      errorCode: operationalErrorCode(error),
    })
    return {
      body: { status: "pending_reconcile", bookingGroupId: bookingGroup.id, gcalEventId: null },
      status: 202,
      headers: { "Retry-After": "60" },
    }
  }

  try {
    await confirmBooking(gcalEventId)
  } catch (error) {
    const errorCode = operationalErrorCode(error)
    logPrivacySafeChatbotEvent({
      event: "booking_db_confirm_failed_after_calendar_success",
      errorCode,
    })
    try {
      await prisma.adminActionLog.create({
        data: {
          actorEmail: "system:booking-service",
          action: "GCAL_OK_DB_CONFIRM_FAILED",
          payload: JSON.stringify({
            bookingGroupId: bookingGroup.id,
            gcalEventId,
            errorCode,
          }),
        },
      })
    } catch (logError) {
      logPrivacySafeChatbotEvent({
        event: "booking_reconcile_marker_write_failed",
        errorCode: operationalErrorCode(logError),
      })
    }

    return {
      body: { status: "pending_reconcile", bookingGroupId: bookingGroup.id, gcalEventId },
      status: 202,
      headers: { "Retry-After": "60" },
    }
  }

  invalidateCalendarFreeBusyCacheForUser(userId, teamId)
  await sendCustomerReceipt(input, userEmail, bookingGroup.id, scheduleLabel)

  return {
    body: {
      status: "ok",
      bookingGroupId: bookingGroup.id,
      bookingIds,
      bookingStatus: "CONFIRMED",
    },
    status: 200,
  }
}

async function existingIdempotentBookingResult(existing: {
  id: string
  status: string
  timeSlots: Array<{ id: string; startTime?: Date; endTime?: Date }>
  calendarEvents?: Array<{ status: string }>
}, calendarId?: string): Promise<CreateBookingResult> {
  const bookingIds = existing.timeSlots.map((slot) => slot.id)
  let effectiveStatus = existing.status
  const scheduleLabel = existing.timeSlots.length > 0
    ? existing.timeSlots
        .map((slot) => slot.startTime && slot.endTime ? `${slot.startTime.toISOString()} - ${slot.endTime.toISOString()}` : "")
        .filter(Boolean)
        .join(" / ")
    : "候補日未選択"

  const hasPendingCalendarEvents = existing.calendarEvents?.some((event) =>
    event.status === "PENDING_CREATE" || event.status === "PENDING_UPDATE" || event.status === "PENDING_DELETE") ?? false
  if (hasPendingCalendarEvents && calendarId) {
    try {
      const accessToken = await refreshStoredCalendarToken()
      const results = await syncBookingGroupCalendarEvents({ bookingGroupId: existing.id, calendarId, accessToken })
      if (!allCalendarEventSyncsSucceeded(results)) {
        return {
          status: 202,
          headers: { "Retry-After": "60" },
          body: {
            status: "processing",
            bookingGroupId: existing.id,
            bookingIds,
            bookingStatus: effectiveStatus,
            scheduleLabel,
            idempotentReplay: true,
          },
        }
      }
      const primaryEventId = results[0]?.eventId ?? null
      if (existing.timeSlots.length > 0 && effectiveStatus === "PENDING_GCAL") {
        await prisma.$transaction([
          prisma.bookingGroup.update({
            where: { id: existing.id },
            data: {
              status: "CONFIRMED",
              gcalEventId: primaryEventId,
              pendingExpiresAt: null,
            },
          }),
          prisma.bookingTimeSlot.updateMany({
            where: { bookingGroupId: existing.id },
            data: { status: "CONFIRMED" },
          }),
        ])
        effectiveStatus = "CONFIRMED"
      } else {
        await prisma.bookingGroup.update({
          where: { id: existing.id },
          data: { gcalEventId: primaryEventId, pendingExpiresAt: null },
        })
      }
    } catch {
      return {
        status: 202,
        headers: { "Retry-After": "60" },
        body: {
          status: "processing",
          bookingGroupId: existing.id,
          bookingIds,
          bookingStatus: effectiveStatus,
          scheduleLabel,
          idempotentReplay: true,
        },
      }
    }
  }

  if (effectiveStatus === "FAILED") {
    return {
      status: 502,
      body: { error: "calendar_unavailable", bookingGroupId: existing.id, idempotentReplay: true },
    }
  }
  if (effectiveStatus === "CANCELLED") {
    return {
      status: 409,
      body: { error: "booking_cancelled", bookingGroupId: existing.id, idempotentReplay: true },
    }
  }
  if (effectiveStatus === "PENDING_GCAL") {
    return {
      status: 202,
      body: {
        status: "processing",
        bookingGroupId: existing.id,
        bookingIds,
        bookingStatus: effectiveStatus,
        scheduleLabel,
        idempotentReplay: true,
      },
    }
  }

  const needsSchedule = effectiveStatus === "NEEDS_SCHEDULE"
  return {
    status: 200,
    body: {
      status: needsSchedule ? "schedule_unselected" : "ok",
      bookingGroupId: existing.id,
      bookingIds,
      bookingStatus: effectiveStatus,
      ...(needsSchedule ? { scheduleStatus: "unscheduled" } : {}),
      scheduleLabel,
      idempotentReplay: true,
    },
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002")
}
