import type { Prisma, PrismaClient } from "@prisma/client"

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

type BookingConflictClient = Prisma.TransactionClient | PrismaClient

type FindConflictOptions = {
  excludeBookingId?: string
}

function isClient(candidate: FindConflictOptions | BookingConflictClient): candidate is BookingConflictClient {
  return "bookingTimeSlot" in candidate
}

export async function findConflictingBookings(
  start: Date,
  end: Date,
  optionsOrClient: FindConflictOptions | BookingConflictClient = {},
  clientArg?: BookingConflictClient,
): Promise<ConflictBooking[]> {
  const client = clientArg ?? (isClient(optionsOrClient) ? optionsOrClient : prisma)
  const options = isClient(optionsOrClient) ? {} : optionsOrClient
  const now = new Date()
  const activeStatuses = ["PENDING_GCAL", "CONFIRMED"]

  const slots = await client.bookingTimeSlot.findMany({
    where: {
      ...(options.excludeBookingId ? { id: { not: options.excludeBookingId } } : {}),
      startTime: { lt: end },
      endTime: { gt: start },
      status: { in: activeStatuses },
      bookingGroup: {
        status: { in: activeStatuses },
        OR: [
          { pendingExpiresAt: null },
          { pendingExpiresAt: { gt: now } },
        ],
      },
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
  }) as ConflictBooking[]

  return slots.filter((slot) => {
    if (!activeStatuses.includes(slot.status as "PENDING_GCAL" | "CONFIRMED")) return false
    if (!activeStatuses.includes(slot.bookingGroup.status as "PENDING_GCAL" | "CONFIRMED")) return false
    const expiresAt = slot.bookingGroup.pendingExpiresAt
    return expiresAt === null || expiresAt > now
  })
}
