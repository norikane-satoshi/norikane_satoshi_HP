import { prisma } from "@/lib/prisma"

export type ConflictBookingStatus = "CONFIRMED"

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
      status: "CONFIRMED",
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
    .filter((slot) => slot.bookingGroup.status === "CONFIRMED")
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
  | { kind: "block"; code: "slot_taken" }

export function evaluateConflicts(conflicts: ConflictBooking[]): PreflightVerdict {
  if (conflicts.length > 0) {
    return { kind: "block", code: "slot_taken" }
  }
  return { kind: "ok" }
}

export function resolveConflictForFinalSubmit(
  conflicts: ConflictBooking[],
): "slot_taken" | null {
  if (conflicts.length > 0) return "slot_taken"
  return null
}
