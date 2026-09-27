import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { respondInternalError } from "@/lib/api/server/error-response"
import { jobContextSchema, workflowEstimateSchema } from "@/lib/chatbot/server/booking-request-schemas"
import { planChatbotWorkSchedule } from "@/lib/chatbot/server/work-schedule-plan"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const requestSchema = z.object({
  jobContext: jobContextSchema,
  workflowEstimate: workflowEstimateSchema,
  attendanceDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(10),
})

/** Where the owner's work days fall around the attendance days the customer is choosing. */
export async function POST(request: NextRequest) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const schedule = await planChatbotWorkSchedule(parsed.data)
    return NextResponse.json({ days: schedule.days, shortfall: schedule.shortfall ?? null, lines: schedule.lines })
  } catch (error) {
    return respondInternalError(error, "chatbot.booking-plan.POST")
  }
}
