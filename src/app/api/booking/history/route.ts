import { NextResponse } from "next/server"

import { auth } from "@/auth"
import { respondInternalError } from "@/lib/api/server/error-response"
import { listBookingHistoryForUser } from "@/lib/booking/server/history"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  try {
    return NextResponse.json({ bookings: await listBookingHistoryForUser(userId) })
  } catch (error) {
    return respondInternalError(error, "booking.history.GET")
  }
}
