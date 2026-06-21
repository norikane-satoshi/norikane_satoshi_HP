import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { respondInternalError } from "@/lib/api/server/error-response"
import type { JobContext, WorkflowEstimate } from "@/lib/chatbot/domain"
import { findCandidateCalendar } from "@/lib/chatbot/server/availability-finder"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const workflowStageSchema = z.enum(["conform", "prep", "attended", "final-check", "delivery"])
const riskFlagSchema = z.enum(["tight-deadline", "heavy-retouch", "strict-delivery", "on-site-transfer"])
const jobKindSchema = z.enum(["cm-30s", "mv-5m", "feature-90m", "drama-first", "drama-follow-up", "vertical-60s", "live-60m"])
const workSiteSchema = z.enum(["satoshi-studio", "remote-grading", "on-site"])
const finalMediumSchema = z.enum(["ott", "cinema", "tv-broadcast", "live", "web", "vertical-sns", "other"])

const documentaryAttachmentSchema = z.union([
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("digest"), count: z.number() }),
  z.object({ kind: z.literal("interview"), count: z.number() }),
  z.object({ kind: z.literal("bonus"), count: z.number() }),
  z.object({ kind: z.literal("making"), count: z.number() }),
  z.object({ kind: z.literal("other"), count: z.number(), note: z.string() }),
])

const workflowEstimateSchema = z.object({
  stages: z.array(z.object({
    stage: workflowStageSchema,
    minDays: z.number(),
    maxDays: z.number(),
    note: z.string().optional(),
  })),
  totalMinDays: z.number().positive(),
  totalMaxDays: z.number().positive(),
  riskFlags: z.array(riskFlagSchema),
  requiresDirectContact: z.boolean().optional(),
}) satisfies z.ZodType<WorkflowEstimate>

const jobContextSchema = z.object({
  jobKind: jobKindSchema.optional(),
  finalMedium: finalMediumSchema,
  workSite: workSiteSchema,
  documentaryAttachment: documentaryAttachmentSchema,
  retouchCutCount: z.number().optional(),
  heavyRetouch: z.boolean().optional(),
  projectLengthMinutes: z.number().optional(),
  publicReleaseDate: z.string().optional(),
  preferredStartDate: z.string().optional(),
  preferredAttendanceDates: z.array(z.string()).optional(),
  referenceUrls: z.array(z.string()).optional(),
  additionalWork: z.array(z.enum(["retouch", "skin-retouch", "other"])).optional(),
  workflowEstimate: workflowEstimateSchema.optional(),
}) satisfies z.ZodType<JobContext>

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
      desiredDeadline: parsed.data.jobContext.publicReleaseDate,
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
