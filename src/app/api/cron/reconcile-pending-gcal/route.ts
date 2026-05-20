import { NextRequest, NextResponse } from "next/server"

import { getCachedCalendarAccessToken } from "@/lib/booking/server/calendar-free-busy/google-token-cache"
import {
  CALENDAR_TOKEN_USER_ID,
  getCalendarEvent,
} from "@/lib/google-calendar/server"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PENDING_STATUSES = ["PENDING_GCAL", "PENDING_GCAL_MOVE", "PENDING_GCAL_DELETE"] as const

type ReconcileCounters = {
  reconciledCount: number
  failedCount: number
  rollbackCount: number
}

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

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const counters: ReconcileCounters = {
    reconciledCount: 0,
    failedCount: 0,
    rollbackCount: 0,
  }

  try {
    const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
    if (!calendarId) {
      console.error("[RECONCILE_PENDING]", "GOOGLE_CALENDAR_BUSY_SOURCE_ID is not set")
      return NextResponse.json({ ok: true, ...counters })
    }

    const { token } = await getCachedCalendarAccessToken(CALENDAR_TOKEN_USER_ID)
    const expiredGroups = await prisma.bookingGroup.findMany({
      where: {
        status: { in: [...PENDING_STATUSES] },
        pendingExpiresAt: { lt: new Date() },
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

    await logReconcile(counters)
  } catch (error) {
    console.error("[RECONCILE_PENDING]", error)
  }

  return NextResponse.json({ ok: true, ...counters })
}
