import type { BookingCalendarEvent, Prisma } from "@prisma/client"

import { calendarBookingSummary } from "@/lib/booking/domain/calendar-summary"
import { normalizeBookingDateKeys } from "@/lib/booking/domain/form-schema"
import {
  createCalendarEvent,
  deleteCalendarEventWithAccessToken,
  getCalendarEvent,
  HP_BOOKING_CANCEL_ACK_KEY,
  requestCalendarEventCancellation,
  updateCalendarEvent,
  type CalendarEventSnapshot,
} from "@/lib/google-calendar/server"
import { prisma } from "@/lib/prisma"

export const BOOKING_CALENDAR_EVENT_STATUS = {
  pendingCreate: "PENDING_CREATE",
  pendingUpdate: "PENDING_UPDATE",
  confirmed: "CONFIRMED",
  pendingDelete: "PENDING_DELETE",
  superseded: "SUPERSEDED",
  cancelled: "CANCELLED",
} as const

export type BookingCalendarEventStatus =
  (typeof BOOKING_CALENDAR_EVENT_STATUS)[keyof typeof BOOKING_CALENDAR_EVENT_STATUS]

export type BookingCalendarEventIntent = {
  eventId: string
  startValue: string
  endValue: string
  dateOnly: boolean
  summary: string
  description: string
  colorId: string
  notionTaskType?: "仮押さえ" | "本予約"
  transparency?: "opaque" | "transparent"
}

type RequestedDateRange = { start: string; end: string }
type CalendarCustomerIdentity = { customerName?: string; customerCompany?: string }

function nextDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export function requestedDateRanges(dates: string[]): RequestedDateRange[] {
  const normalizedDates = normalizeBookingDateKeys(dates)
  if (normalizedDates.length === 0) return []
  const ranges: RequestedDateRange[] = []
  let start = normalizedDates[0]
  let last = start
  for (const date of normalizedDates.slice(1)) {
    if (date === nextDateKey(last)) {
      last = date
      continue
    }
    ranges.push({ start, end: nextDateKey(last) })
    start = date
    last = date
  }
  ranges.push({ start, end: nextDateKey(last) })
  return ranges
}

export function buildRequestedDateCalendarEventIntents(input: {
  bookingGroupId: string
  dates: string[]
  summary: string
  description: string
  notionTaskType?: "仮押さえ" | "本予約"
  /** What each date holds (立ち会い, 仕込み…); appended to that day's event title. */
  dateLabels?: Record<string, string>
}): BookingCalendarEventIntent[] {
  const baseEventId = input.bookingGroupId.toLowerCase().replace(/[^a-v0-9]/g, "")
  // One all-day event per requested date: each event becomes one IB_仕事 row
  // (one row = one working day), so day-rate fees add up per day.
  return normalizeBookingDateKeys(input.dates).map((date, index) => {
    const label = input.dateLabels?.[date]
    return {
      eventId: index === 0 ? baseEventId : `${baseEventId}${date.replaceAll("-", "")}`,
      startValue: date,
      endValue: nextDateKey(date),
      dateOnly: true,
      summary: label ? `${input.summary}（${label}）` : input.summary,
      description: input.description,
      colorId: "4",
      notionTaskType: input.notionTaskType ?? "仮押さえ",
      transparency: "transparent",
    }
  })
}

export type CalendarEventSyncResult = {
  eventId: string
  action: "created" | "updated" | "delete_requested" | "deleted" | "verified" | "skipped"
  ok: boolean
}

export function allCalendarEventSyncsSucceeded(results: CalendarEventSyncResult[]): boolean {
  return results.length > 0 && results.every((result) => result.ok)
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; name?: unknown }
    if (typeof candidate.code === "string" && candidate.code) return candidate.code.slice(0, 100)
    if (typeof candidate.name === "string" && candidate.name) return candidate.name.slice(0, 100)
  }
  return "calendar_event_sync_failed"
}

function assertCalendarEventOwnership(
  existing: { bookingGroupId?: string },
  event: BookingCalendarEvent,
): void {
  if (existing.bookingGroupId && existing.bookingGroupId !== event.bookingGroupId) {
    throw Object.assign(new Error("Google Calendar event belongs to another booking group"), {
      code: "calendar_event_ownership_mismatch",
    })
  }
}

function sameCalendarValue(left: string, right: string, dateOnly: boolean): boolean {
  if (dateOnly) return left === right
  const leftTime = new Date(left).getTime()
  const rightTime = new Date(right).getTime()
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime
}

async function preserveObservedBookingConfirmation(
  existing: CalendarEventSnapshot,
  event: BookingCalendarEvent,
): Promise<BookingCalendarEvent> {
  if (existing.notionTaskType !== "本予約" || event.notionTaskType === "本予約") return event
  const data = {
    notionTaskType: "本予約",
    summary: calendarBookingSummary(event.summary, "本予約"),
    transparency: existing.transparency === "opaque" || existing.transparency === "transparent"
      ? existing.transparency
      : event.transparency,
  }
  await prisma.bookingCalendarEvent.update({ where: { eventId: event.eventId }, data })
  return { ...event, ...data }
}

function calendarProjectionMatches(
  existing: {
    start?: string
    end?: string
    dateOnly?: boolean
    summary?: string
    description?: string
    colorId?: string
    notionTaskType?: string
    transparency?: string
    privateProperties?: Record<string, string>
  },
  event: BookingCalendarEvent,
  customerIdentity: CalendarCustomerIdentity,
): boolean {
  if (!existing.start || !existing.end || existing.dateOnly === undefined) return true
  const expectedTransparency = event.transparency ?? "opaque"
  return existing.dateOnly === event.dateOnly
    && sameCalendarValue(existing.start, event.startValue, event.dateOnly)
    && sameCalendarValue(existing.end, event.endValue, event.dateOnly)
    && existing.summary === calendarBookingSummary(event.summary, event.notionTaskType)
    && existing.description === event.description
    && existing.colorId === event.colorId
    && existing.notionTaskType === (event.notionTaskType ?? undefined)
    && (existing.transparency ?? "opaque") === expectedTransparency
    && (customerIdentity.customerName === undefined || existing.privateProperties?.customer_name === customerIdentity.customerName)
    && (customerIdentity.customerCompany === undefined || (existing.privateProperties?.customer_company ?? "") === customerIdentity.customerCompany)
}

async function updateCalendarEventFromIntent(input: {
  event: BookingCalendarEvent
  calendarId: string
  accessToken: string
  customerIdentity: CalendarCustomerIdentity
}): Promise<void> {
  const { event, calendarId, accessToken, customerIdentity } = input
  await updateCalendarEvent({
    calendarId,
    eventId: event.eventId,
    accessToken,
    start: event.startValue,
    end: event.endValue,
    dateOnly: event.dateOnly,
    summary: calendarBookingSummary(event.summary, event.notionTaskType),
    description: event.description,
    colorId: event.colorId,
    bookingGroupId: event.bookingGroupId,
    ...customerIdentity,
    notionTaskType: event.notionTaskType === "本予約" ? "本予約" : "仮押さえ",
    transparency: event.transparency === "transparent" ? "transparent" : "opaque",
  })
}

export function calendarEventCreateData(
  bookingGroupId: string,
  intent: BookingCalendarEventIntent,
): Prisma.BookingCalendarEventCreateManyInput {
  return {
    bookingGroupId,
    ...intent,
    notionTaskType: intent.notionTaskType ?? null,
    transparency: intent.transparency ?? null,
    status: BOOKING_CALENDAR_EVENT_STATUS.pendingCreate,
  }
}

export async function persistCalendarEventIntents(
  tx: Prisma.TransactionClient,
  bookingGroupId: string,
  intents: BookingCalendarEventIntent[],
): Promise<void> {
  if (intents.length === 0) return
  await tx.bookingCalendarEvent.createMany({
    data: intents.map((intent) => calendarEventCreateData(bookingGroupId, intent)),
  })
}

async function markAttempt(eventId: string): Promise<void> {
  await prisma.bookingCalendarEvent.update({
    where: { eventId },
    data: {
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
      lastErrorCode: null,
    },
  })
}

async function markFailure(eventId: string, error: unknown): Promise<void> {
  await prisma.bookingCalendarEvent.update({
    where: { eventId },
    data: { lastErrorCode: errorCode(error) },
  })
}

export async function syncCalendarEventIntent(input: {
  event: BookingCalendarEvent
  calendarId: string
  accessToken: string
  verifyConfirmed?: boolean
}): Promise<CalendarEventSyncResult> {
  const { calendarId, accessToken } = input
  let event = input.event
  const status = event.status as BookingCalendarEventStatus
  if (status === BOOKING_CALENDAR_EVENT_STATUS.cancelled) {
    return { eventId: event.eventId, action: "skipped", ok: true }
  }

  await markAttempt(event.eventId)
  try {
    if (status === BOOKING_CALENDAR_EVENT_STATUS.pendingDelete) {
      const existing = await getCalendarEvent({ calendarId, eventId: event.eventId, accessToken })
      if (existing?.privateProperties[HP_BOOKING_CANCEL_ACK_KEY] !== "1") {
        if (existing) {
          await requestCalendarEventCancellation({
            calendarId,
            eventId: event.eventId,
            bookingGroupId: event.bookingGroupId,
            accessToken,
          })
          await prisma.bookingCalendarEvent.update({
            where: { eventId: event.eventId },
            data: { lastVerifiedAt: new Date(), lastErrorCode: null },
          })
          return { eventId: event.eventId, action: "delete_requested", ok: false }
        }
      } else {
        await deleteCalendarEventWithAccessToken({ calendarId, eventId: event.eventId, accessToken })
      }
      await prisma.bookingCalendarEvent.update({
        where: { eventId: event.eventId },
        data: {
          status: BOOKING_CALENDAR_EVENT_STATUS.cancelled,
          lastVerifiedAt: new Date(),
          lastErrorCode: null,
        },
      })
      return { eventId: event.eventId, action: "deleted", ok: true }
    }

    const group = await prisma.bookingGroup.findUnique({
      where: { id: event.bookingGroupId },
      select: { contactName: true, companyName: true },
    })
    const customerIdentity: CalendarCustomerIdentity = group
      ? { customerName: group.contactName, customerCompany: group.companyName ?? "" }
      : {}

    if (status === BOOKING_CALENDAR_EVENT_STATUS.confirmed && input.verifyConfirmed) {
      const existing = await getCalendarEvent({ calendarId, eventId: event.eventId, accessToken })
      if (existing) {
        assertCalendarEventOwnership(existing, event)
        event = await preserveObservedBookingConfirmation(existing, event)
        if (!calendarProjectionMatches(existing, event, customerIdentity)) {
          await updateCalendarEventFromIntent({ event, calendarId, accessToken, customerIdentity })
          await prisma.bookingCalendarEvent.update({
            where: { eventId: event.eventId },
            data: { lastVerifiedAt: new Date(), lastErrorCode: null },
          })
          return { eventId: event.eventId, action: "updated", ok: true }
        }
        await prisma.bookingCalendarEvent.update({
          where: { eventId: event.eventId },
          data: { lastVerifiedAt: new Date(), lastErrorCode: null },
        })
        return { eventId: event.eventId, action: "verified", ok: true }
      }
    }

    if (status === BOOKING_CALENDAR_EVENT_STATUS.pendingUpdate) {
      const existing = await getCalendarEvent({ calendarId, eventId: event.eventId, accessToken })
      if (existing) {
        assertCalendarEventOwnership(existing, event)
        event = await preserveObservedBookingConfirmation(existing, event)
        await updateCalendarEventFromIntent({ event, calendarId, accessToken, customerIdentity })
      } else {
        await createCalendarEvent({
          calendarId,
          eventId: event.eventId,
          start: event.startValue,
          end: event.endValue,
          dateOnly: event.dateOnly,
          summary: calendarBookingSummary(event.summary, event.notionTaskType),
          description: event.description,
          colorId: event.colorId,
          accessToken,
          bookingGroupId: event.bookingGroupId,
          ...customerIdentity,
          notionTaskType: event.notionTaskType === "本予約" ? "本予約" : "仮押さえ",
          transparency: event.transparency === "opaque" ? "opaque" : event.transparency === "transparent" ? "transparent" : undefined,
        })
      }
      await prisma.bookingCalendarEvent.update({
        where: { eventId: event.eventId },
        data: {
          status: BOOKING_CALENDAR_EVENT_STATUS.confirmed,
          lastVerifiedAt: new Date(),
          lastErrorCode: null,
        },
      })
      return { eventId: event.eventId, action: existing ? "updated" : "created", ok: true }
    }

    await createCalendarEvent({
      calendarId,
      eventId: event.eventId,
      start: event.startValue,
      end: event.endValue,
      dateOnly: event.dateOnly,
      summary: calendarBookingSummary(event.summary, event.notionTaskType),
      description: event.description,
      colorId: event.colorId,
      accessToken,
      bookingGroupId: event.bookingGroupId,
      ...customerIdentity,
      notionTaskType: event.notionTaskType === "本予約" ? "本予約" : "仮押さえ",
      transparency: event.transparency === "opaque" ? "opaque" : event.transparency === "transparent" ? "transparent" : undefined,
    })
    await prisma.bookingCalendarEvent.update({
      where: { eventId: event.eventId },
      data: {
        status: BOOKING_CALENDAR_EVENT_STATUS.confirmed,
        lastVerifiedAt: new Date(),
        lastErrorCode: null,
      },
    })
    return { eventId: event.eventId, action: "created", ok: true }
  } catch (error) {
    await markFailure(event.eventId, error)
    return {
      eventId: event.eventId,
      action: status === BOOKING_CALENDAR_EVENT_STATUS.pendingDelete ? "delete_requested" : "created",
      ok: false,
    }
  }
}

export async function syncBookingGroupCalendarEvents(input: {
  bookingGroupId: string
  calendarId: string
  accessToken: string
  verifyConfirmed?: boolean
  eventIds?: string[]
}): Promise<CalendarEventSyncResult[]> {
  const events = await prisma.bookingCalendarEvent.findMany({
    where: {
      bookingGroupId: input.bookingGroupId,
      ...(input.eventIds ? { eventId: { in: input.eventIds } } : {}),
      status: input.verifyConfirmed
        ? { not: BOOKING_CALENDAR_EVENT_STATUS.cancelled }
        : { in: [
            BOOKING_CALENDAR_EVENT_STATUS.pendingCreate,
            BOOKING_CALENDAR_EVENT_STATUS.pendingUpdate,
            BOOKING_CALENDAR_EVENT_STATUS.pendingDelete,
          ] },
    },
    orderBy: { createdAt: "asc" },
  })
  const results: CalendarEventSyncResult[] = []
  for (const event of events) {
    results.push(await syncCalendarEventIntent({
      event,
      calendarId: input.calendarId,
      accessToken: input.accessToken,
      verifyConfirmed: input.verifyConfirmed,
    }))
  }
  return results
}

export async function markBookingGroupCalendarEventsForDeletion(bookingGroupId: string): Promise<number> {
  const result = await prisma.bookingCalendarEvent.updateMany({
    where: {
      bookingGroupId,
      status: { not: BOOKING_CALENDAR_EVENT_STATUS.cancelled },
    },
    data: { status: BOOKING_CALENDAR_EVENT_STATUS.pendingDelete },
  })
  return result.count
}

export async function cancelBookingGroupCalendarEvents(input: {
  bookingGroupId: string
  calendarId: string
  accessToken: string
}): Promise<{ complete: boolean; results: CalendarEventSyncResult[] }> {
  const group = await prisma.bookingGroup.findUnique({
    where: { id: input.bookingGroupId },
    include: {
      calendarEvents: true,
      timeSlots: { orderBy: { startTime: "asc" }, take: 1 },
    },
  })
  if (!group) return { complete: true, results: [] }

  if (group.calendarEvents.length === 0 && group.gcalEventId) {
    const slot = group.timeSlots[0]
    await prisma.bookingCalendarEvent.create({
      data: {
        bookingGroupId: group.id,
        eventId: group.gcalEventId,
        startValue: slot?.startTime.toISOString() ?? "",
        endValue: slot?.endTime.toISOString() ?? "",
        dateOnly: false,
        summary: `【仮キープ】${group.projectTitle} / ${group.contactName}`,
        description: group.memo ?? "",
        colorId: "9",
        notionTaskType: "仮押さえ",
        status: BOOKING_CALENDAR_EVENT_STATUS.pendingDelete,
      },
    })
  } else {
    await markBookingGroupCalendarEventsForDeletion(group.id)
  }

  await prisma.bookingGroup.update({
    where: { id: group.id },
    data: { status: "PENDING_GCAL_DELETE", pendingExpiresAt: new Date(Date.now() + 60_000) },
  })

  const results = await syncBookingGroupCalendarEvents({
    bookingGroupId: group.id,
    calendarId: input.calendarId,
    accessToken: input.accessToken,
  })
  const remaining = await prisma.bookingCalendarEvent.count({
    where: {
      bookingGroupId: group.id,
      status: { not: BOOKING_CALENDAR_EVENT_STATUS.cancelled },
    },
  })
  const complete = remaining === 0
  if (complete) {
    await prisma.$transaction([
      prisma.bookingTimeSlot.updateMany({
        where: { bookingGroupId: group.id },
        data: { status: "CANCELLED" },
      }),
      prisma.bookingGroup.update({
        where: { id: group.id },
        data: { status: "CANCELLED", gcalEventId: null, pendingExpiresAt: null },
      }),
    ])
  }
  return { complete, results }
}

export async function replaceBookingGroupCalendarEventIntents(input: {
  bookingGroupId: string
  intents: BookingCalendarEventIntent[]
  calendarId: string
  accessToken: string
}): Promise<{
  complete: boolean
  upsertResults: CalendarEventSyncResult[]
  deleteResults: CalendarEventSyncResult[]
}> {
  const desiredIds = input.intents.map((intent) => intent.eventId)
  await prisma.$transaction(async (tx) => {
    for (const intent of input.intents) {
      const existing = await tx.bookingCalendarEvent.findUnique({ where: { eventId: intent.eventId } })
      const changed = Boolean(existing && (
        existing.startValue !== intent.startValue ||
        existing.endValue !== intent.endValue ||
        existing.dateOnly !== intent.dateOnly ||
        existing.summary !== intent.summary ||
        existing.description !== intent.description ||
        existing.colorId !== intent.colorId ||
        existing.notionTaskType !== (intent.notionTaskType ?? null) ||
        existing.transparency !== (intent.transparency ?? null)
      ))
      await tx.bookingCalendarEvent.upsert({
        where: { eventId: intent.eventId },
        create: calendarEventCreateData(input.bookingGroupId, intent),
        update: {
          ...intent,
          notionTaskType: intent.notionTaskType ?? null,
          transparency: intent.transparency ?? null,
          status: existing?.status === BOOKING_CALENDAR_EVENT_STATUS.cancelled
            ? BOOKING_CALENDAR_EVENT_STATUS.pendingCreate
            : changed
              ? BOOKING_CALENDAR_EVENT_STATUS.pendingUpdate
              : existing?.status,
          lastErrorCode: null,
        },
      })
    }
    await tx.bookingCalendarEvent.updateMany({
      where: {
        bookingGroupId: input.bookingGroupId,
        eventId: { notIn: desiredIds },
        status: { not: BOOKING_CALENDAR_EVENT_STATUS.cancelled },
      },
      data: { status: BOOKING_CALENDAR_EVENT_STATUS.superseded },
    })
    await tx.bookingGroup.update({
      where: { id: input.bookingGroupId },
      data: {
        status: "PENDING_GCAL_REPLACE",
        pendingExpiresAt: new Date(Date.now() + 60_000),
      },
    })
  })

  const upsertResults = await syncBookingGroupCalendarEvents({
    bookingGroupId: input.bookingGroupId,
    calendarId: input.calendarId,
    accessToken: input.accessToken,
    eventIds: desiredIds,
  })
  if (upsertResults.some((result) => !result.ok)) {
    return { complete: false, upsertResults, deleteResults: [] }
  }
  const continuation = await continueBookingGroupCalendarReplacement({
    bookingGroupId: input.bookingGroupId,
    calendarId: input.calendarId,
    accessToken: input.accessToken,
  })
  return { complete: continuation.complete, upsertResults, deleteResults: continuation.deleteResults }
}

export async function continueBookingGroupCalendarReplacement(input: {
  bookingGroupId: string
  calendarId: string
  accessToken: string
}): Promise<{ complete: boolean; deleteResults: CalendarEventSyncResult[] }> {
  const events = await prisma.bookingCalendarEvent.findMany({
    where: { bookingGroupId: input.bookingGroupId },
    orderBy: { createdAt: "asc" },
    select: { eventId: true, status: true },
  })
  const desired = events.filter((event) =>
    event.status !== BOOKING_CALENDAR_EVENT_STATUS.superseded
    && event.status !== BOOKING_CALENDAR_EVENT_STATUS.pendingDelete
    && event.status !== BOOKING_CALENDAR_EVENT_STATUS.cancelled)
  if (
    desired.length === 0
    || desired.some((event) => event.status !== BOOKING_CALENDAR_EVENT_STATUS.confirmed)
  ) {
    return { complete: false, deleteResults: [] }
  }

  const obsoleteIds = events
    .filter((event) =>
      event.status === BOOKING_CALENDAR_EVENT_STATUS.superseded
      || event.status === BOOKING_CALENDAR_EVENT_STATUS.pendingDelete)
    .map((event) => event.eventId)
  if (obsoleteIds.length > 0) {
    await prisma.bookingCalendarEvent.updateMany({
      where: {
        eventId: { in: obsoleteIds },
        status: BOOKING_CALENDAR_EVENT_STATUS.superseded,
      },
      data: { status: BOOKING_CALENDAR_EVENT_STATUS.pendingDelete },
    })
  }
  const deleteResults = obsoleteIds.length > 0
    ? await syncBookingGroupCalendarEvents({
        bookingGroupId: input.bookingGroupId,
        calendarId: input.calendarId,
        accessToken: input.accessToken,
        eventIds: obsoleteIds,
      })
    : []
  const remaining = await prisma.bookingCalendarEvent.count({
    where: {
      bookingGroupId: input.bookingGroupId,
      status: { in: [
        BOOKING_CALENDAR_EVENT_STATUS.superseded,
        BOOKING_CALENDAR_EVENT_STATUS.pendingDelete,
      ] },
    },
  })
  const complete = remaining === 0
  if (complete) {
    await prisma.bookingGroup.update({
      where: { id: input.bookingGroupId },
      data: {
        status: "NEEDS_SCHEDULE",
        gcalEventId: desired[0]?.eventId ?? null,
        pendingExpiresAt: null,
      },
    })
  }
  return { complete, deleteResults }
}
