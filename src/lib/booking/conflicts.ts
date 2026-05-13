import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"

export type ConflictBooking = Prisma.BookingTimeSlotGetPayload<{
  include: {
    bookingGroup: {
      include: {
        customer: {
          select: {
            displayName: true
            user: { select: { email: true } }
          }
        }
      }
    }
  }
}>

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

  return slots.filter((slot) => slot.bookingGroup.status === "CONFIRMED")
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
