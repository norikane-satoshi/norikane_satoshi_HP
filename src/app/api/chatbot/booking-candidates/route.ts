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
    const calendar = await findCandidateCalendar({
      jobContext: parsed.data.jobContext,
      workflowEstimate: parsed.data.workflowEstimate,
      desiredDeadline: parsed.data.jobContext.publicReleaseDate,
      notBefore: `${parsed.data.month}-01`,
      now: new Date(`${parsed.data.month}-01T00:00:00.000+09:00`),
      lookaheadWeeks: 9,
      candidateLimit: 31,
      busyMode: "block",
    })

    return NextResponse.json(calendar)
  } catch (error) {
    return respondInternalError(error, "chatbot.booking-candidates.POST")
  }
}
