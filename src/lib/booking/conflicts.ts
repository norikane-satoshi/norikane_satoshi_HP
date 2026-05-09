import { prisma } from "@/lib/prisma"

export type ConflictBookingStatus = "CONFIRMED" | "PENDING_CONFIRMATION" | "TENTATIVE"

export type ConflictBooking = {
  id: string
  bookingGroupId: string
  startTime: Date
  endTime: Date
  title: string
  status: string
  memo: string | null
  gcalEventId: string | null
  customer: {
    displayName: string
    user: {
      email: string | null
    }
  }
}

export async function findConflictingBookings(
  start: Date,
  end: Date,
  options: { excludeBookingId?: string } = {},
): Promise<ConflictBooking[]> {
  const slots = await prisma.bookingTimeSlot.findMany({
    where: {
      ...(options.excludeBookingId ? { id: { not: options.excludeBookingId } } : {}),
      startTime: { lt: end },
      endTime: { gt: start },
      status: { in: ["CONFIRMED", "TENTATIVE", "PENDING_CONFIRMATION"] },
    },
    include: {
      bookingGroup: {
        include: {
          customer: {
            select: {
              displayName: true,
              user: {
                select: {
                  email: true,
                },
              },
            },
          },
        },
      },
    },
  })

  return slots
    .filter((slot) => ["CONFIRMED", "TENTATIVE", "PENDING_CONFIRMATION"].includes(slot.bookingGroup.status))
    .map((slot) => ({
      id: slot.id,
      bookingGroupId: slot.bookingGroupId,
      startTime: slot.startTime,
      endTime: slot.endTime,
      title: slot.bookingGroup.projectTitle,
      status: slot.bookingGroup.status,
      memo: slot.bookingGroup.memo,
      gcalEventId: slot.bookingGroup.gcalEventId,
      customer: slot.bookingGroup.customer,
    }))
}

export type PreflightVerdict =
  | { kind: "ok" }
  | { kind: "block"; code: "slot_taken" | "slot_pending" }
  | { kind: "warn"; message: string }

export function evaluateConflicts(
  conflicts: ConflictBooking[],
  bookingKind: "confirmed" | "tentative",
): PreflightVerdict {
  if (conflicts.some((booking) => booking.status === "CONFIRMED")) {
    return { kind: "block", code: "slot_taken" }
  }
  if (conflicts.some((booking) => booking.status === "PENDING_CONFIRMATION")) {
    return { kind: "block", code: "slot_pending" }
  }
  const tentativeConflict = conflicts.find((booking) => booking.status === "TENTATIVE")
  if (tentativeConflict) {
    if (bookingKind === "tentative") {
      return { kind: "block", code: "slot_pending" }
    }
    return {
      kind: "warn",
      message: "仮キープと重なります（先着優先で 3 日タイマー）",
    }
  }
  return { kind: "ok" }
}

export function resolveConflictForFinalSubmit(
  conflicts: ConflictBooking[],
  bookingKind: "confirmed" | "tentative",
): "slot_taken" | "slot_pending" | "tentative_exists" | null {
  if (conflicts.some((booking) => booking.status === "CONFIRMED")) return "slot_taken"
  if (conflicts.some((booking) => booking.status === "PENDING_CONFIRMATION")) return "slot_pending"
  if (conflicts.length > 0 && bookingKind === "tentative") return "tentative_exists"
  return null
}
