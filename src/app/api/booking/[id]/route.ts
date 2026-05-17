import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { findAccessibleSlot, type AccessibleBooking } from "@/lib/booking/server/edit-access"
import { deleteCalendarEvent } from "@/lib/google-calendar/server"
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

async function getAccessibleBooking(id: string) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
  }

  const booking = await findAccessibleSlot(id, userId, isCalendarAdmin(session.user?.email))
  if (!booking) {
    return { response: NextResponse.json({ error: "not_found" }, { status: 404 }) }
  }

  return { booking }
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
  const mutableResponse = assertMutable(booking)
  if (mutableResponse) return mutableResponse

  const raw = (await request.json().catch(() => null)) as {
    action?: unknown
    start?: unknown
    end?: unknown
    projectTitle?: unknown
    contactName?: unknown
    contactEmail?: unknown
    phone?: unknown
    companyName?: unknown
    memo?: unknown
    dueDate?: unknown
  } | null

  if (!raw || (raw.action !== "move" && raw.action !== "copy" && raw.action !== "update_details")) {
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

  if (!isValidDateRange(raw.start, raw.end)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (raw.action === "move") {
    const updated = await prisma.bookingTimeSlot.update({
      where: { id },
      data: {
        startTime: new Date(raw.start),
        endTime: new Date(raw.end as string),
      },
    })
    return NextResponse.json({
      status: "ok",
      action: "move",
      bookingId: updated.id,
      bookingGroupId: updated.bookingGroupId,
    })
  }

  const created = await prisma.bookingTimeSlot.create({
    data: {
      bookingGroupId: booking.bookingGroupId,
      startTime: new Date(raw.start),
      endTime: new Date(raw.end as string),
      status: booking.details.status,
    },
  })
  return NextResponse.json({
    status: "ok",
    action: "copy",
    bookingId: created.id,
    bookingGroupId: created.bookingGroupId,
  })
}
