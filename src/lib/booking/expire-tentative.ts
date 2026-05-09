import type { Prisma } from "@prisma/client"

import { sendBookingTentativeExpiredEmail, type BookingEmailArgs } from "@/lib/booking/email"
import { deleteCalendarEvent } from "@/lib/google-calendar"
import { prisma } from "@/lib/prisma"

type ExpirableBooking = Prisma.BookingGroupGetPayload<{
  include: { customer: { include: { user: true } }; timeSlots: true }
}>

type ExpirableStatus = "TENTATIVE" | "PENDING_CONFIRMATION"

export type ExpireTentativeError = {
  bookingId: string
  status: ExpirableStatus
  stage: "db" | "gcal" | "email"
  error: string
}

export type ProcessExpiredBookingResult = {
  bookingId: string
  status: ExpirableStatus
  expired: boolean
  errors: ExpireTentativeError[]
}

function isExpirableStatus(status: string): status is ExpirableStatus {
  return status === "TENTATIVE" || status === "PENDING_CONFIRMATION"
}

function nextStatus(status: ExpirableStatus): "CANCELLED" | "OVERWRITTEN" {
  return status === "TENTATIVE" ? "CANCELLED" : "OVERWRITTEN"
}

function logTag(status: ExpirableStatus): "tentative" | "pending_confirmation" {
  return status === "TENTATIVE" ? "tentative" : "pending_confirmation"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function warnExpiredFailure(status: ExpirableStatus, bookingId: string, error: string) {
  console.warn(`[cron expire failed] tag=${logTag(status)} bookingId=${bookingId} error=${error}`)
}

function createExpiredEmailArgs(booking: ExpirableBooking, to: string): BookingEmailArgs {
  return {
    to,
    projectTitle: booking.projectTitle,
    start: booking.timeSlots[0]?.startTime ?? new Date(),
    end: booking.timeSlots[0]?.endTime ?? new Date(),
    workScopes: [],
    otherWorkDetail: booking.memo ?? "",
    estimatedDuration: "consult",
  }
}

export async function processExpiredBooking(booking: ExpirableBooking): Promise<ProcessExpiredBookingResult> {
  if (!isExpirableStatus(booking.status)) {
    throw new Error(`Unsupported booking status for tentative expiry: ${booking.status}`)
  }

  const status = booking.status
  const errors: ExpireTentativeError[] = []

  try {
    await prisma.bookingGroup.update({
      where: { id: booking.id },
      data: {
        status: nextStatus(status),
        timeSlots: {
          updateMany: {
            where: {},
            data: { status: nextStatus(status) },
          },
        },
      },
    })
  } catch (error) {
    const message = errorMessage(error)
    warnExpiredFailure(status, booking.id, message)
    errors.push({ bookingId: booking.id, status, stage: "db", error: message })
    return { bookingId: booking.id, status, expired: false, errors }
  }

  if (booking.gcalEventId) {
    try {
      await deleteCalendarEvent(booking.gcalEventId)
    } catch (error) {
      const message = errorMessage(error)
      warnExpiredFailure(status, booking.id, message)
      errors.push({ bookingId: booking.id, status, stage: "gcal", error: message })
    }
  }

  const to = booking.customer.user.email
  if (!to) {
    const message = "Customer user email is missing"
    warnExpiredFailure(status, booking.id, message)
    errors.push({ bookingId: booking.id, status, stage: "email", error: message })
    return { bookingId: booking.id, status, expired: true, errors }
  }

  try {
    await sendBookingTentativeExpiredEmail(createExpiredEmailArgs(booking, to))
  } catch (error) {
    const message = errorMessage(error)
    warnExpiredFailure(status, booking.id, message)
    errors.push({ bookingId: booking.id, status, stage: "email", error: message })
  }

  return { bookingId: booking.id, status, expired: true, errors }
}
