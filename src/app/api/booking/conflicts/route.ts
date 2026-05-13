import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import {
  bookingConflictsRequestSchema,
  mapErrorCodeToJa,
  type BookingConflictsResponse,
} from "@/lib/booking/domain/api-schema"
import { evaluateConflicts, findConflictingBookings } from "@/lib/booking/conflicts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const parsed = bookingConflictsRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { start, end, excludeBookingId } = parsed.data
  const startDate = new Date(start)
  const endDate = new Date(end)

  const conflicts = await findConflictingBookings(startDate, endDate, { excludeBookingId })
  const verdict = evaluateConflicts(conflicts)

  let response: BookingConflictsResponse
  if (verdict.kind === "ok") {
    response = { verdict: "ok" }
  } else {
    response = {
      verdict: "block",
      reason: verdict.code,
      message: mapErrorCodeToJa(verdict.code),
    }
  }

  return NextResponse.json(response)
}
