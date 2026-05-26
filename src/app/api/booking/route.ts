import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { enforceBodyLimit } from "@/lib/api/server/body-limit"
import { respondInternalError } from "@/lib/api/server/error-response"
import { bookingApiSchema } from "@/lib/booking/domain/api-schema"
import { createBookingFromApiInput } from "@/lib/booking/server/create-booking"
import { BookingConflictError } from "@/lib/booking/server/errors"
import { isTeamMember } from "@/lib/booking/server/team-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function responseForConflict(error: string) {
  return NextResponse.json({ error }, { status: 409 })
}

export async function POST(request: NextRequest) {
  const bodyLimit = enforceBodyLimit(request)
  if (bodyLimit) return bodyLimit

  const session = await auth()
  const userId = session?.user?.id
  const userEmail = session?.user?.email

  if (!userId || !userEmail) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const parsed = bookingApiSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const input = parsed.data

  if (userEmail !== input.sessionEmail) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const teamId = input.teamId ?? null
  if (teamId && !(await isTeamMember(userId, teamId))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  try {
    const result = await createBookingFromApiInput({ input, userId, userEmail })
    return NextResponse.json(result.body, { status: result.status, headers: result.headers })
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return responseForConflict(error.message)
    }
    return respondInternalError(error, "booking.POST")
  }
}
