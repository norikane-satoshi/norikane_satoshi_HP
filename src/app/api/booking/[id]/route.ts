import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { deleteCalendarEvent } from "@/lib/google-calendar"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isValidDateRange(start: unknown, end: unknown): start is string {
  return (
    typeof start === "string" &&
    typeof end === "string" &&
    !Number.isNaN(Date.parse(start)) &&
    !Number.isNaN(Date.parse(end)) &&
    new Date(start) < new Date(end)
  )
}

async function findOwnedSlot(slotId: string, userId: string) {
  const slot = await prisma.bookingTimeSlot.findUnique({
    where: { id: slotId },
    include: {
      bookingGroup: {
        include: {
          customer: true,
        },
      },
    },
  })

  if (!slot) return null
  if (slot.bookingGroup.customer.userId !== userId) return null
  return slot
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await context.params
  const slot = await findOwnedSlot(id, userId)
  if (!slot) return NextResponse.json({ error: "not_found" }, { status: 404 })

  await prisma.bookingTimeSlot.update({
    where: { id },
    data: { status: "CANCELLED" },
  })

  if (slot.bookingGroup.gcalEventId) {
    await deleteCalendarEvent(slot.bookingGroup.gcalEventId)
    await prisma.bookingGroup.update({
      where: { id: slot.bookingGroupId },
      data: { gcalEventId: null },
    })
  }

  return NextResponse.json({ status: "ok", bookingId: id })
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await context.params
  const slot = await findOwnedSlot(id, userId)
  if (!slot) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const raw = (await request.json().catch(() => null)) as {
    action?: unknown
    start?: unknown
    end?: unknown
  } | null
  if (!raw || (raw.action !== "move" && raw.action !== "copy") || !isValidDateRange(raw.start, raw.end)) {
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
      bookingGroupId: slot.bookingGroupId,
      startTime: new Date(raw.start),
      endTime: new Date(raw.end as string),
      status: slot.bookingGroup.status,
    },
  })
  return NextResponse.json({
    status: "ok",
    action: "copy",
    bookingId: created.id,
    bookingGroupId: created.bookingGroupId,
  })
}
