import { z } from "zod"

import {
  chatbotAuditStageTimingsSchema,
  type ChatbotAuditStageTimings,
} from "@/lib/chatbot/audit/contract"

const stageMetricSchema = z.object({
  sampleCount: z.number().int().min(5),
  p50Ms: z.number().int().nonnegative(),
  p95Ms: z.number().int().nonnegative(),
  maxAllowedMs: z.number().int().nonnegative(),
}).strict()

export const chatbotPerformanceBaselineSchema = z.object({
  schemaVersion: z.literal("1"),
  buildSha: z.string().trim().min(1).max(64).regex(/^[a-z0-9._-]+$/i),
  measuredAt: z.string().datetime({ offset: true }),
  sampleCount: z.number().int().min(5),
  allowedRegressionRatio: z.number().min(1).max(3),
  minimumHeadroomMs: z.number().int().nonnegative().max(60_000),
  stages: z.record(z.string(), stageMetricSchema),
}).strict().superRefine((baseline, context) => {
  if (!baseline.stages.totalServer) {
    context.addIssue({
      code: "custom",
      path: ["stages", "totalServer"],
      message: "performance_baseline_requires_total_server",
    })
  }
})

export type ChatbotPerformanceBaseline = z.infer<typeof chatbotPerformanceBaselineSchema>

export function calibrateChatbotPerformanceBaseline(input: {
  buildSha: string
  measuredAt: string
  allowedRegressionRatio: number
  minimumHeadroomMs: number
  samples: ChatbotAuditStageTimings[]
}): ChatbotPerformanceBaseline {
  if (input.samples.length < 5) {
    throw new Error("performance_baseline_requires_five_samples")
  }
  const samples = input.samples.map((sample) => chatbotAuditStageTimingsSchema.parse(sample))
  const stageNames = new Set(samples.flatMap((sample) => Object.keys(sample)))
  const stages: Record<string, z.infer<typeof stageMetricSchema>> = {}

  for (const stageName of stageNames) {
    const values = samples
      .flatMap((sample) => typeof sample[stageName as keyof ChatbotAuditStageTimings] === "number"
        ? [sample[stageName as keyof ChatbotAuditStageTimings] as number]
        : [])
      .sort((left, right) => left - right)
    if (values.length < 5) continue
    const p50Ms = percentileNearestRank(values, 0.5)
    const p95Ms = percentileNearestRank(values, 0.95)
    stages[stageName] = {
      sampleCount: values.length,
      p50Ms,
      p95Ms,
      maxAllowedMs: Math.max(
        Math.ceil(p95Ms * input.allowedRegressionRatio),
        p95Ms + input.minimumHeadroomMs,
      ),
    }
  }

  return chatbotPerformanceBaselineSchema.parse({
    schemaVersion: "1",
    buildSha: input.buildSha,
    measuredAt: input.measuredAt,
    sampleCount: samples.length,
    allowedRegressionRatio: input.allowedRegressionRatio,
    minimumHeadroomMs: input.minimumHeadroomMs,
    stages,
  })
}

export function evaluateChatbotPerformanceObservation(input: {
  baseline: ChatbotPerformanceBaseline | null
  stageTimings: ChatbotAuditStageTimings
}): { status: "within-budget" | "regressed" | "unbaselined"; violations: string[] } {
  if (!input.baseline) return { status: "unbaselined", violations: ["baseline-missing"] }
  const baseline = chatbotPerformanceBaselineSchema.parse(input.baseline)
  const observation = chatbotAuditStageTimingsSchema.parse(input.stageTimings)
  const violations = Object.entries(baseline.stages)
    .filter(([stageName, metric]) => {
      const value = observation[stageName as keyof ChatbotAuditStageTimings]
      return typeof value === "number" && value > metric.maxAllowedMs
    })
    .map(([stageName]) => stageName)
    .sort()
  return {
    status: violations.length > 0 ? "regressed" : "within-budget",
    violations,
  }
}

function percentileNearestRank(sortedValues: number[], percentile: number): number {
  const index = Math.max(0, Math.ceil(sortedValues.length * percentile) - 1)
  return sortedValues[index]
}
