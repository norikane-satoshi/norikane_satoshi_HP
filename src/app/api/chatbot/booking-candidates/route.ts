import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { respondInternalError } from "@/lib/api/server/error-response"
import { findCandidateCalendar } from "@/lib/chatbot/server/availability-finder"
import { jobContextSchema, workflowEstimateSchema } from "@/lib/chatbot/server/booking-request-schemas"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const requestSchema = z.object({
  jobContext: jobContextSchema,
  workflowEstimate: workflowEstimateSchema,
  month: z.string().regex(/^\d{4}-\d{2}$/),
})

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function jstDateKey(value: Date): string {
  const jst = new Date(value.getTime() + JST_OFFSET_MS)
  return [
    String(jst.getUTCFullYear()),
    String(jst.getUTCMonth() + 1).padStart(2, "0"),
    String(jst.getUTCDate()).padStart(2, "0"),
  ].join("-")
}

function parsedDateTime(value: string): Date | null {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000+09:00`)
    : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function laterIsoDate(left: string, right?: string): string {
  if (!right) return left
  const leftDate = parsedDateTime(left)
  const rightDate = parsedDateTime(right)

  if (!leftDate || !rightDate) return left
  return rightDate.getTime() > leftDate.getTime() ? right : left
}

function latestIsoDate(first: string, ...rest: Array<string | undefined>): string {
  let latest = first
  for (const value of rest) {
    latest = laterIsoDate(latest, value)
  }
  return latest
}

export async function POST(request: NextRequest) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  try {
    const now = new Date()
    const calendar = await findCandidateCalendar({
      jobContext: parsed.data.jobContext,
      workflowEstimate: parsed.data.workflowEstimate,
      notBefore: latestIsoDate(`${parsed.data.month}-01`, parsed.data.jobContext.preferredStartDate, jstDateKey(now)),
      busyFrom: `${parsed.data.month}-01`,
      now,
      lookaheadWeeks: 9,
      candidateLimit: 31,
      busyMode: "block",
    })

    return NextResponse.json(calendar)
  } catch (error) {
    return respondInternalError(error, "chatbot.booking-candidates.POST")
  }
}
