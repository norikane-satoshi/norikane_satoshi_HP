import { z } from "zod"

import type { JobContext, WorkflowEstimate } from "@/lib/chatbot/domain"

// The job facts and estimate the booking card sends back to the server, shared by the calendar,
// schedule plan and booking routes.
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

export const workflowEstimateSchema = z.object({
  stages: z.array(z.object({
    stage: workflowStageSchema,
    minDays: z.number(),
    maxDays: z.number(),
    note: z.string().optional(),
  })),
  totalMinDays: z.number().positive(),
  totalMaxDays: z.number().positive(),
  attendanceDays: z.number().positive().optional(),
  note: z.string().optional(),
  riskFlags: z.array(riskFlagSchema),
  requiresDirectContact: z.boolean().optional(),
}) satisfies z.ZodType<WorkflowEstimate>

export const jobContextSchema = z.object({
  jobKind: jobKindSchema.optional(),
  finalMedium: finalMediumSchema,
  workSite: workSiteSchema,
  documentaryAttachment: documentaryAttachmentSchema,
  retouchCutCount: z.number().optional(),
  heavyRetouch: z.boolean().optional(),
  attendanceDays: z.number().positive().optional(),
  strictDeliveryClient: z.boolean().optional(),
  projectLengthMinutes: z.number().optional(),
  publicReleaseDate: z.string().optional(),
  preferredStartDate: z.string().optional(),
  preferredAttendanceDates: z.array(z.string()).optional(),
  referenceUrls: z.array(z.string()).optional(),
  additionalWork: z.array(z.enum(["retouch", "skin-retouch", "other"])).optional(),
  workflowEstimate: workflowEstimateSchema.optional(),
}) satisfies z.ZodType<JobContext>
