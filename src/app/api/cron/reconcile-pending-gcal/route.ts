import { bookingExternalWritesEnabled, BOOKING_EXTERNAL_WRITES_DISABLED } from "@/lib/booking/server/external-write-policy"
import { isChatbotDiagnosticRequest } from "@/lib/chatbot/server/diagnostic-request"

import { NextRequest, NextResponse } from "next/server"

import { getCachedCalendarAccessToken } from "@/lib/booking/server/calendar-free-busy/google-token-cache"
import {
  cleanupExpiredChatbotConversations,
  type CleanupExpiredChatbotConversationsResult,
} from "@/lib/chatbot/server/cleanup-conversations"
import {
  CALENDAR_TOKEN_USER_ID,
  getCalendarEvent,
} from "@/lib/google-calendar/server"
import {
  BOOKING_CALENDAR_EVENT_STATUS,
  continueBookingGroupCalendarReplacement,
  syncCalendarEventIntent,
} from "@/lib/booking/server/calendar-event-lifecycle"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PENDING_STATUSES = ["PENDING_GCAL", "PENDING_GCAL_MOVE", "PENDING_GCAL_DELETE"] as const

type ReconcileCounters = {
  reconciledCount: number
  failedCount: number
  rollbackCount: number
  eventVerifiedCount: number
  eventRecreatedCount: number
  eventUpdatedCount: number
  eventDeletedCount: number
  eventPendingCount: number
}

type ChatbotCleanupSummary =
  | ({ ok: true } & CleanupExpiredChatbotConversationsResult)
  | { ok: false; error: "cleanup_failed" }

function sanitizeGcalEventId(id: string): string {
  return id.toLowerCase().replace(/[^a-v0-9]/g, "")
}

async function markConfirmed(bookingGroupId: string, gcalEventId: string | null) {
  await prisma.bookingGroup.update({
    where: { id: bookingGroupId },
    data: {
      status: "CONFIRMED",
      gcalEventId,
      pendingExpiresAt: null,
    },
  })
  await prisma.bookingTimeSlot.updateMany({
    where: { bookingGroupId },
    data: { status: "CONFIRMED" },
  })
}

async function markFailed(bookingGroupId: string) {
  await prisma.bookingGroup.update({
    where: { id: bookingGroupId },
    data: {
      status: "FAILED",
      pendingExpiresAt: null,
    },
  })
  await prisma.bookingTimeSlot.updateMany({
    where: { bookingGroupId },
    data: { status: "FAILED" },
  })
}

async function rollbackMove(bookingGroup: {
  id: string
  gcalEventId: string | null
  timeSlots: {
    id: string
    previousStartTime: Date | null
    previousEndTime: Date | null
  }[]
}) {
  for (const slot of bookingGroup.timeSlots) {
    await prisma.bookingTimeSlot.update({
      where: { id: slot.id },
      data: {
        ...(slot.previousStartTime ? { startTime: slot.previousStartTime } : {}),
        ...(slot.previousEndTime ? { endTime: slot.previousEndTime } : {}),
        previousStartTime: null,
        previousEndTime: null,
        status: "CONFIRMED",
      },
    })
  }
  await prisma.bookingGroup.update({
    where: { id: bookingGroup.id },
    data: {
      status: "CONFIRMED",
      gcalEventId: bookingGroup.gcalEventId,
      pendingExpiresAt: null,
    },
  })
}

async function logReconcile(counters: ReconcileCounters) {
  await prisma.adminActionLog.create({
    data: {
      actorEmail: "system@cron",
      action: "RECONCILE_PENDING",
      payload: JSON.stringify(counters),
    },
  })
}

async function runChatbotCleanup(): Promise<ChatbotCleanupSummary> {
  try {
    return {
      ok: true,
      ...(await cleanupExpiredChatbotConversations()),
    }
  } catch (error) {
    console.error("[cleanup-chatbot-conversations]", error)
    return { ok: false, error: "cleanup_failed" }
  }
}

async function settleBookingGroupFromManagedEvents(bookingGroupId: string): Promise<void> {
  const [group, events] = await Promise.all([
    prisma.bookingGroup.findUnique({
      where: { id: bookingGroupId },
      select: { id: true, status: true },
    }),
    prisma.bookingCalendarEvent.findMany({
      where: { bookingGroupId },
      orderBy: { createdAt: "asc" },
      select: { eventId: true, status: true },
    }),
  ])
  if (!group || events.length === 0) return

  if (events.every((event) => event.status === BOOKING_CALENDAR_EVENT_STATUS.cancelled)) {
    await prisma.$transaction([
      prisma.bookingTimeSlot.updateMany({
        where: { bookingGroupId },
        data: { status: "CANCELLED" },
      }),
      prisma.bookingGroup.update({
        where: { id: bookingGroupId },
        data: { status: "CANCELLED", gcalEventId: null, pendingExpiresAt: null },
      }),
    ])
    return
  }

  if (group.status === "PENDING_GCAL_REPLACE") return
  if (!events.every((event) => event.status === BOOKING_CALENDAR_EVENT_STATUS.confirmed)) return
  const primaryEventId = events[0]?.eventId ?? null
  if (group.status === "PENDING_GCAL") {
    await markConfirmed(bookingGroupId, primaryEventId)
    return
  }
  await prisma.bookingGroup.update({
    where: { id: bookingGroupId },
    data: { gcalEventId: primaryEventId, pendingExpiresAt: null },
  })
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  if (!bookingExternalWritesEnabled() || isChatbotDiagnosticRequest(request.headers)) {
    return NextResponse.json({ error: BOOKING_EXTERNAL_WRITES_DISABLED }, { status: 503 })
  }

  const counters: ReconcileCounters = {
    reconciledCount: 0,
    failedCount: 0,
    rollbackCount: 0,
    eventVerifiedCount: 0,
    eventRecreatedCount: 0,
    eventUpdatedCount: 0,
    eventDeletedCount: 0,
    eventPendingCount: 0,
  }

  let chatbotCleanup: ChatbotCleanupSummary
  try {
    const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
    if (!calendarId) {
      console.error("[RECONCILE_PENDING]", "GOOGLE_CALENDAR_BUSY_SOURCE_ID is not set")
    } else {
      const { token } = await getCachedCalendarAccessToken(CALENDAR_TOKEN_USER_ID)
      const verifyBefore = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const managedEvents = await prisma.bookingCalendarEvent.findMany({
        where: {
          OR: [
            { status: { in: [
              BOOKING_CALENDAR_EVENT_STATUS.pendingCreate,
              BOOKING_CALENDAR_EVENT_STATUS.pendingUpdate,
              BOOKING_CALENDAR_EVENT_STATUS.pendingDelete,
            ] } },
            {
              status: BOOKING_CALENDAR_EVENT_STATUS.confirmed,
              OR: [
                { lastVerifiedAt: null },
                { lastVerifiedAt: { lt: verifyBefore } },
              ],
            },
          ],
        },
        orderBy: [{ lastAttemptAt: "asc" }, { createdAt: "asc" }],
        take: 100,
      })
      const affectedGroupIds = new Set<string>()
      for (const event of managedEvents) {
        affectedGroupIds.add(event.bookingGroupId)
        const result = await syncCalendarEventIntent({
          event,
          calendarId,
          accessToken: token,
          verifyConfirmed: event.status === BOOKING_CALENDAR_EVENT_STATUS.confirmed,
        })
        if (!result.ok) counters.eventPendingCount += 1
        else if (result.action === "verified") counters.eventVerifiedCount += 1
        else if (result.action === "created") counters.eventRecreatedCount += 1
        else if (result.action === "updated") counters.eventUpdatedCount += 1
        else if (result.action === "deleted") counters.eventDeletedCount += 1
      }
      for (const bookingGroupId of affectedGroupIds) {
        await settleBookingGroupFromManagedEvents(bookingGroupId)
      }
      const pendingReplacements = await prisma.bookingGroup.findMany({
        where: { status: "PENDING_GCAL_REPLACE" },
        orderBy: { pendingExpiresAt: "asc" },
        select: { id: true },
        take: 50,
      })
      for (const group of pendingReplacements) {
        const replacement = await continueBookingGroupCalendarReplacement({
          bookingGroupId: group.id,
          calendarId,
          accessToken: token,
        })
        counters.eventDeletedCount += replacement.deleteResults.filter((result) => result.ok).length
        counters.eventPendingCount += replacement.deleteResults.filter((result) => !result.ok).length
      }

      const expiredGroups = await prisma.bookingGroup.findMany({
        where: {
          status: { in: [...PENDING_STATUSES] },
          pendingExpiresAt: { lt: new Date() },
          calendarEvents: { none: {} },
        },
        include: {
          timeSlots: {
            select: {
              id: true,
              previousStartTime: true,
              previousEndTime: true,
            },
          },
        },
        take: 50,
      })

      for (const bookingGroup of expiredGroups) {
        const eventId = bookingGroup.gcalEventId ?? sanitizeGcalEventId(bookingGroup.id)
        const event = await getCalendarEvent({
          calendarId,
          eventId,
          accessToken: token,
        })

        if (event) {
          await markConfirmed(bookingGroup.id, event.id)
          counters.reconciledCount += 1
          continue
        }

        if (bookingGroup.status === "PENDING_GCAL") {
          await markFailed(bookingGroup.id)
          counters.failedCount += 1
        } else if (bookingGroup.status === "PENDING_GCAL_MOVE") {
          await rollbackMove(bookingGroup)
          counters.rollbackCount += 1
        } else if (bookingGroup.status === "PENDING_GCAL_DELETE") {
          await markConfirmed(bookingGroup.id, bookingGroup.gcalEventId)
          counters.rollbackCount += 1
        }
      }
    }

    await logReconcile(counters)
  } catch (error) {
    console.error("[RECONCILE_PENDING]", error)
  } finally {
    chatbotCleanup = await runChatbotCleanup()
  }

  return NextResponse.json({ ok: true, ...counters, chatbotCleanup })
}
