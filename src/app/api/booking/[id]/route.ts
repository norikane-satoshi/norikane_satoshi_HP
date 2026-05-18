import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { findConflictingBookings } from "@/lib/booking/server/conflicts"
import { findAccessibleSlot, type AccessibleBooking } from "@/lib/booking/server/edit-access"
import { sendBookingTimeChangedEmail } from "@/lib/booking/server/email"
import { invalidateCalendarFreeBusyCacheForUser } from "@/lib/booking/server/calendar-free-busy/free-busy"
import { getCachedCalendarAccessToken } from "@/lib/booking/server/calendar-free-busy/google-token-cache"
import {
  CALENDAR_TOKEN_USER_ID,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "@/lib/google-calendar/server"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isCalendarAdmin(email?: string | null): boolean {
  const adminEmail = process.env.BOOKING_CALENDAR_ADMIN_EMAIL
  return Boolean(adminEmail && email === adminEmail)
}

function isPastBooking(booking: AccessibleBooking): boolean {
  const currentSlot = booking.timeSlots.find((slot) => slot.id === booking.bookingId)
  if (!currentSlot) return false
  return Date.now() > new Date(currentSlot.startTime).getTime()
}

function canMutateBooking(booking: AccessibleBooking): boolean {
  return booking.scope === "owner" || booking.scope === "admin"
}

function isValidDateRange(start: unknown, end: unknown): start is string {
  return (
    typeof start === "string" &&
    typeof end === "string" &&
    !Number.isNaN(Date.parse(start)) &&
    !Number.isNaN(Date.parse(end)) &&
    new Date(start) < new Date(end)
  )
}

function nullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

function invalidateBookingFreeBusyCaches(booking: AccessibleBooking, viewerUserId: string): void {
  invalidateCalendarFreeBusyCacheForUser(viewerUserId, booking.details.teamId)
  if (booking.details.customerUserId !== viewerUserId) {
    invalidateCalendarFreeBusyCacheForUser(booking.details.customerUserId, booking.details.teamId)
  }
}

type AccessibleBookingResult =
  | { response: NextResponse; booking?: undefined; userId?: undefined }
  | { response?: undefined; booking: AccessibleBooking; userId: string }

async function getAccessibleBooking(id: string): Promise<AccessibleBookingResult> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
  }

  const booking = await findAccessibleSlot(id, userId, isCalendarAdmin(session.user?.email))
  if (!booking) {
    return { response: NextResponse.json({ error: "not_found" }, { status: 404 }) }
  }

  return { booking, userId }
}

function assertMutable(booking: AccessibleBooking) {
  if (booking.scope !== "admin" && isPastBooking(booking)) {
    return NextResponse.json({ error: "past_booking_locked" }, { status: 403 })
  }
  if (!canMutateBooking(booking)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  return null
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const result = await getAccessibleBooking(id)
  if (result.response) return result.response

  const booking = result.booking
  return NextResponse.json({
    bookingId: booking.bookingId,
    bookingGroupId: booking.bookingGroupId,
    scope: booking.scope,
    details: booking.details,
    timeSlots: booking.timeSlots,
  })
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const result = await getAccessibleBooking(id)
  if (result.response) return result.response

  const booking = result.booking
  const mode = request.nextUrl.searchParams.get("mode") ?? "cancel"
  if (mode !== "cancel" && mode !== "hard") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }
  const mutableResponse = assertMutable(booking)
  if (mutableResponse) return mutableResponse

  if (mode === "hard") {
    if (booking.scope !== "admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    if (booking.gcalEventId) {
      await deleteCalendarEvent(booking.gcalEventId)
    }
    await prisma.bookingGroup.delete({
      where: { id: booking.bookingGroupId },
    })
    return NextResponse.json({ status: "ok", mode: "hard", bookingGroupId: booking.bookingGroupId })
  }

  await prisma.bookingTimeSlot.update({
    where: { id },
    data: { status: "CANCELLED" },
  })

  if (booking.gcalEventId) {
    await deleteCalendarEvent(booking.gcalEventId)
    await prisma.bookingGroup.update({
      where: { id: booking.bookingGroupId },
      data: { gcalEventId: null },
    })
  }

  return NextResponse.json({ status: "ok", mode: "cancel", bookingId: id })
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const result = await getAccessibleBooking(id)
  if (result.response) return result.response

  const booking = result.booking
  const userId = result.userId
  const mutableResponse = assertMutable(booking)
  if (mutableResponse) return mutableResponse

  const raw = (await request.json().catch(() => null)) as {
    action?: unknown
    start?: unknown
    end?: unknown
    side?: unknown
    hours?: unknown
    projectTitle?: unknown
    contactName?: unknown
    contactEmail?: unknown
    phone?: unknown
    companyName?: unknown
    memo?: unknown
    dueDate?: unknown
  } | null

  if (!raw || (raw.action !== "move" && raw.action !== "update_details" && raw.action !== "resize_buffer")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (raw.action === "update_details") {
    const data: {
      projectTitle?: string
      contactName?: string
      contactEmail?: string | null
      phone?: string | null
      companyName?: string | null
      memo?: string | null
      dueDate?: string | null
    } = {}

    if (raw.projectTitle !== undefined) {
      if (typeof raw.projectTitle !== "string" || raw.projectTitle.trim() === "") {
        return NextResponse.json({ error: "invalid_request" }, { status: 400 })
      }
      data.projectTitle = raw.projectTitle.trim()
    }
    if (raw.contactName !== undefined) {
      if (typeof raw.contactName !== "string" || raw.contactName.trim() === "") {
        return NextResponse.json({ error: "invalid_request" }, { status: 400 })
      }
      data.contactName = raw.contactName.trim()
    }
    for (const key of ["contactEmail", "phone", "companyName", "memo", "dueDate"] as const) {
      const value = raw[key]
      if (value !== undefined) {
        if (typeof value !== "string") return NextResponse.json({ error: "invalid_request" }, { status: 400 })
        data[key] = nullable(value)
      }
    }

    const updated = await prisma.bookingGroup.update({
      where: { id: booking.bookingGroupId },
      data,
    })
    return NextResponse.json({
      status: "ok",
      action: "update_details",
      bookingGroupId: updated.id,
    })
  }

  if (raw.action === "resize_buffer") {
    if (booking.scope !== "admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    if (raw.side !== "before" && raw.side !== "after") {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 })
    }
    if (!Number.isFinite(raw.hours) || typeof raw.hours !== "number" || raw.hours < 0) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 })
    }
    const currentSlot = booking.timeSlots.find((slot) => slot.id === booking.bookingId)
    if (!currentSlot) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 })
    }
    const slotStart = new Date(currentSlot.startTime)
    const slotEnd = new Date(currentSlot.endTime)
    const bufferMs = raw.hours * 60 * 60 * 1000
    const bufferStart = raw.side === "before" ? new Date(slotStart.getTime() - bufferMs) : slotEnd
    const bufferEnd = raw.side === "before" ? slotStart : new Date(slotEnd.getTime() + bufferMs)
    const conflicts = await findConflictingBookings(bufferStart, bufferEnd, { excludeBookingId: booking.bookingId })
    if (conflicts.length > 0) {
      return NextResponse.json({ error: "slot_taken" }, { status: 409 })
    }

    const updatedGroup = await prisma.bookingGroup.update({
      where: { id: booking.bookingGroupId },
      data: raw.side === "before"
        ? { bufferBeforeHours: raw.hours }
        : { bufferAfterHours: raw.hours },
    })

    const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
    if (calendarId && booking.gcalEventId) {
      try {
        const { token } = await getCachedCalendarAccessToken(CALENDAR_TOKEN_USER_ID)
        await updateCalendarEvent({
          calendarId,
          eventId: booking.gcalEventId,
          accessToken: token,
          start: currentSlot.startTime,
          end: currentSlot.endTime,
          bufferBeforeHours: updatedGroup.bufferBeforeHours,
          bufferAfterHours: updatedGroup.bufferAfterHours,
        })
      } catch (error) {
        console.error(
          `[booking resize buffer gcal update failed] bookingId=${id} eventId=${booking.gcalEventId} error=${error instanceof Error ? error.message : String(error)}`,
        )
        return NextResponse.json({ error: "calendar_update_failed" }, { status: 502 })
      }
    }

    invalidateBookingFreeBusyCaches(booking, userId)

    return NextResponse.json({
      status: "ok",
      action: "resize_buffer",
      bookingGroupId: booking.bookingGroupId,
      side: raw.side,
      hours: raw.hours,
    })
  }

  if (!isValidDateRange(raw.start, raw.end)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }
  const start = raw.start
  const end = raw.end as string

  const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
  if (booking.gcalEventId && calendarId) {
    try {
      const { token } = await getCachedCalendarAccessToken(CALENDAR_TOKEN_USER_ID)
      await updateCalendarEvent({
        calendarId,
        eventId: booking.gcalEventId,
        accessToken: token,
        start,
        end,
      })
    } catch (error) {
      console.error(
        `[booking move gcal update failed] bookingId=${id} eventId=${booking.gcalEventId} error=${error instanceof Error ? error.message : String(error)}`,
      )
      return NextResponse.json({ error: "calendar_update_failed" }, { status: 502 })
    }
  }

  const updated = await prisma.bookingTimeSlot.update({
    where: { id },
    data: {
      startTime: new Date(start),
      endTime: new Date(end),
    },
  })

  if (booking.scope === "admin" && booking.details.customerUserId !== userId && booking.details.contactEmail) {
    const oldSlot = booking.timeSlots.find((slot) => slot.id === id)
    if (oldSlot) {
      try {
        await sendBookingTimeChangedEmail({
          to: booking.details.contactEmail,
          projectTitle: booking.details.projectTitle,
          oldStart: oldSlot.startTime,
          oldEnd: oldSlot.endTime,
          newStart: start,
          newEnd: end,
        })
      } catch (error) {
        console.warn(
          `[booking move email failed] bookingId=${id} error=${error instanceof Error ? error.message : String(error)}`,
        )
      }
    } else {
      console.warn(`[booking move email skipped] bookingId=${id} error=old_slot_not_found`)
    }
  }

  invalidateBookingFreeBusyCaches(booking, userId)

  return NextResponse.json({
    status: "ok",
    action: "move",
    bookingId: updated.id,
    bookingGroupId: updated.bookingGroupId,
  })
}
