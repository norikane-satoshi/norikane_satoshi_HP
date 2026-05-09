import { NextResponse, type NextRequest } from "next/server"

import { processExpiredBooking } from "@/lib/booking/expire-tentative"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization")
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const bearerToken = getBearerToken(request)

  if (!cronSecret || bearerToken !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const expired = {
    tentative: 0,
    pendingConfirmation: 0,
  }
  const errors: Awaited<ReturnType<typeof processExpiredBooking>>["errors"] = []

  const bookings = await prisma.bookingGroup.findMany({
    where: {
      status: { in: ["TENTATIVE", "PENDING_CONFIRMATION"] },
      tentativeDeadlineAt: { lt: new Date() },
    },
    include: {
      customer: {
        include: {
          user: true,
        },
      },
      timeSlots: true,
    },
  })

  for (const booking of bookings) {
    const result = await processExpiredBooking(booking)
    errors.push(...result.errors)
    if (!result.expired) continue

    if (result.status === "TENTATIVE") {
      expired.tentative += 1
    } else {
      expired.pendingConfirmation += 1
    }
  }

  return NextResponse.json({
    ok: true,
    expired,
    errors,
  })
}
