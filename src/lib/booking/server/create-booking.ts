import type { BookingApiInput } from "@/lib/booking/domain/api-schema"
import { resolveConflictForFinalSubmit } from "@/lib/booking/domain/conflicts"
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
} from "@/lib/google-calendar/server"
import { prisma } from "@/lib/prisma"

export type CreateBookingResult = {
  body: unknown
  status: number
  headers?: HeadersInit
}

type CreateBookingFromApiInputArgs = {
  input: BookingApiInput
  userId: string
  userEmail: string
}

function nullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

function createDescription(input: BookingApiInput): string {
  return [
    ["候補日", input.selectedSlots.length > 0 ? input.selectedSlots.map((slot) => `${slot.start} - ${slot.end}`).join(" / ") : "候補日未選択"],
    ["案件名", input.projectTitle],
    ["納期", input.dueDate],
    ["会社名", input.companyName],
    ["担当者氏名", input.contactName],
    ["メールアドレス", input.sessionEmail],
    ["電話番号", input.phone],
    ["補足メモ", input.memo],
  ]
    .map(([label, value]) => `${label}: ${value.trim() || "-"}`)
    .join("\n")
}

function createSummary(input: BookingApiInput): string {
  return `【予約確定】${input.projectTitle}`
}

function createBookingEmailArgs(input: BookingApiInput, to: string): BookingEmailArgs {
  const slot = input.selectedSlots[0]
  return {
    to,
    projectTitle: input.projectTitle,
    start: slot.start,
    end: slot.end,
    workScopes: [],
    otherWorkDetail: input.memo,
    estimatedDuration: "consult",
  }
}

async function warnOnEmailFailure(task: Promise<unknown>, tag: string, to: string) {
  try {
    await task
  } catch (error) {
    const message = error instanceof Error ? error.message : "email send failed"
    console.warn(`[email failed] tag=${tag} to=${to}`, message)
  }
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
  userId,
  userEmail,
}: CreateBookingFromApiInputArgs): Promise<CreateBookingResult> {
  const slots = input.selectedSlots
  const primarySlot = slots[0]
  const hasSelectedSlots = slots.length > 0
  const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
  const teamId = input.teamId ?? null
  const storedMemo = [input.memo, hasSelectedSlots ? undefined : "候補日未選択"]
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
    return {
      body: {
        status: "schedule_unselected",
        bookingGroupId: bookingGroup.id,
        bookingIds,
        bookingStatus: "NEEDS_SCHEDULE",
        scheduleStatus: "unscheduled",
        scheduleLabel: "候補日未選択",
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
    await warnOnEmailFailure(
      sendBookingConfirmedEmail(createBookingEmailArgs(input, userEmail)),
      "confirmed",
      userEmail,
    )
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
          actorEmail: userEmail,
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
  await warnOnEmailFailure(
    sendBookingConfirmedEmail(createBookingEmailArgs(input, userEmail)),
    "confirmed",
    userEmail,
  )

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
