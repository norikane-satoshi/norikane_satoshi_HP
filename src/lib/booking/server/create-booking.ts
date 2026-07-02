import type { BookingApiInput } from "@/lib/booking/domain/api-schema"
import { resolveConflictForFinalSubmit } from "@/lib/booking/domain/conflicts"
import { bookingDateRangeToSelection, formatBookingDateSelection, type BookingDateSelection } from "@/lib/booking/domain/form-schema"
import { invalidateCalendarFreeBusyCacheForUser } from "@/lib/booking/server/calendar-free-busy/free-busy"
import { findConflictingBookings } from "@/lib/booking/server/conflicts"
import { BookingConflictError } from "@/lib/booking/server/errors"
import {
  sendBookingConfirmedEmail,
  type BookingEmailArgs,
} from "@/lib/booking/server/email"
import {
  CALENDAR_TOKEN_USER_ID,
  createCalendarEvent,
  refreshCalendarAccessToken,
  type CalendarEventWriteInput,
} from "@/lib/google-calendar/server"
import { sendLineBookingReceipt } from "@/lib/line/messaging"
import { prisma } from "@/lib/prisma"

export type CreateBookingResult = {
  body: unknown
  status: number
  headers?: HeadersInit
}

type CreateBookingFromApiInputArgs = {
  input: BookingApiInput
  notionTaskType?: CalendarEventWriteInput["notionTaskType"]
  originatedFrom?: "web" | "line_liff" | "chatbot"
  userId: string
  userEmail: string | null
}

function nullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

function createDescription(input: BookingApiInput): string {
  return [
    ["候補日", getScheduleLabel(input)],
    ["案件名", input.projectTitle],
    ["納期", input.dueDate],
    ["会社名", input.companyName],
    ["氏名", input.contactName],
    ["メール", input.sessionEmail],
    ["TEL", input.phone],
    ["補足", input.memo],
  ]
    .map(([label, value]) => `${label}: ${value.trim() || "-"}`)
    .join("\n")
}

function createSummary(input: BookingApiInput): string {
  return `【仮キープ】${input.projectTitle}`
}

function createBookingEmailArgs(input: BookingApiInput, to: string, bookingGroupId: string): BookingEmailArgs {
  return {
    to,
    projectTitle: input.projectTitle,
    selectedSlots: input.selectedSlots,
    requestedDates: getRequestedDateSelection(input)?.dates,
    bookingGroupId,
    workScopes: [],
    otherWorkDetail: input.memo,
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
  return requestedDateSelection ? formatBookingDateSelection(requestedDateSelection) : "候補日未選択"
}

async function warnOnEmailFailure(task: Promise<unknown>, tag: string, to: string) {
  try {
    await task
  } catch (error) {
    const message = error instanceof Error ? error.message : "email send failed"
    console.warn(`[email failed] tag=${tag} to=${to}`, message)
  }
}

async function sendTentativeHoldEmail(input: BookingApiInput, to: string | null, bookingGroupId: string) {
  if (!to) return
  await warnOnEmailFailure(
    sendBookingConfirmedEmail(createBookingEmailArgs(input, to, bookingGroupId)),
    "tentative_hold",
    to,
  )
}

async function sendCustomerReceipt(input: BookingApiInput, to: string | null, bookingGroupId: string, scheduleLabel: string) {
  if (input.entryPoint === "line_liff" && input.lineUserId) {
    const result = await sendLineBookingReceipt({
      bookingGroupId,
      lineUserId: input.lineUserId,
      replyToken: input.lineReplyToken,
      projectTitle: input.projectTitle,
      scheduleLabel,
    })
    if (!result.ok) {
      console.warn("LINE booking receipt failed", {
        bookingGroupId,
        method: result.method,
        status: result.status,
        error: result.error,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function createBookingFromApiInput({
  input,
  notionTaskType,
  originatedFrom,
  userId,
  userEmail,
}: CreateBookingFromApiInputArgs): Promise<CreateBookingResult> {
  const slots = input.selectedSlots
  const primarySlot = slots[0]
  const hasSelectedSlots = slots.length > 0
  const scheduleLabel = getScheduleLabel(input)
  const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
  const teamId = input.teamId ?? null
  const storedMemo = [input.memo, hasSelectedSlots ? undefined : `希望日: ${scheduleLabel}`]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n")

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

  const bookingGroup = await prisma.$transaction(async (tx) => {
    const conflictLists = []
    for (const slot of slots) {
      conflictLists.push(
        await findConflictingBookings(new Date(slot.start), new Date(slot.end), {}, tx),
      )
    }
    const conflicts = conflictLists.flat()
    const conflict = resolveConflictForFinalSubmit(conflicts)
    if (conflict) throw new BookingConflictError(conflict)

    return tx.bookingGroup.create({
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
  }, { maxWait: 5000, timeout: 10000 })

  const bookingIds = bookingGroup.timeSlots.map((slot) => slot.id)

  if (!hasSelectedSlots) {
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

  if (!calendarId) {
    await confirmBooking(null)
    invalidateCalendarFreeBusyCacheForUser(userId, teamId)
    await sendCustomerReceipt(input, userEmail, bookingGroup.id, scheduleLabel)
    console.warn("Booking created without Google Calendar event: GOOGLE_CALENDAR_BUSY_SOURCE_ID is not set")
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

  const description = createDescription(input)
  const summary = createSummary(input)
  let gcalEventId: string | null
  try {
    const accessToken = await refreshStoredCalendarToken()
    const eventId = sanitizeGcalEventId(bookingGroup.id)
    const createEvent = () => createCalendarEvent({
      calendarId,
      summary,
      description,
      start: primarySlot.start,
      end: primarySlot.end,
      colorId: "9",
      accessToken,
      eventId,
      notionTaskType,
    })
    let event
    try {
      event = await createEvent()
    } catch {
      await wait(500)
      event = await createEvent()
    }
    gcalEventId = event.id ?? null
  } catch (error) {
    const gcalError = errorMessage(error) || "Google Calendar event write failed"
    console.warn("Booking Google Calendar write failed", {
      bookingGroupId: bookingGroup.id,
      error: gcalError,
    })
    await prisma.bookingGroup.update({
      where: { id: bookingGroup.id },
      data: { status: "FAILED", pendingExpiresAt: null },
    })
    await prisma.bookingTimeSlot.updateMany({
      where: { bookingGroupId: bookingGroup.id },
      data: { status: "FAILED" },
    })

    return {
      body: {
        error: "calendar_unavailable",
        bookingGroupId: bookingGroup.id,
      },
      status: 502,
    }
  }

  try {
    await confirmBooking(gcalEventId)
  } catch (error) {
    const message = errorMessage(error)
    console.error("GCal OK but DB confirm failed", {
      bookingGroupId: bookingGroup.id,
      gcalEventId,
      error: message,
    })
    try {
      await prisma.adminActionLog.create({
        data: {
          actorEmail: userEmail ?? "line_liff",
          action: "GCAL_OK_DB_CONFIRM_FAILED",
          payload: JSON.stringify({
            bookingGroupId: bookingGroup.id,
            gcalEventId,
            error: message,
          }),
        },
      })
    } catch (logError) {
      console.error("Failed to log GCal OK DB confirm failure", logError)
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
