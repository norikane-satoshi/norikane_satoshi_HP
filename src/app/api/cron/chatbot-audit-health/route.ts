import { NextRequest, NextResponse } from "next/server"

import tier1BaselineData from "@/lib/chatbot/audit/performance-baseline-tier1.json"
import tier2BaselineData from "@/lib/chatbot/audit/performance-baseline-tier2.json"
import { chatbotAuditStageTimingsSchema } from "@/lib/chatbot/audit/contract"
import {
  chatbotPerformanceBaselineSchema,
  evaluateChatbotPerformanceScenarios,
} from "@/lib/chatbot/audit/performance"
import { getChatbotBuildSha } from "@/lib/chatbot/server/build-info"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const minimumSampleCount = 5
const baselines = {
  "tier-1-hosted-chrome-notion-ai": chatbotPerformanceBaselineSchema.parse(tier1BaselineData),
  "tier-2-gemini-flash": chatbotPerformanceBaselineSchema.parse(tier2BaselineData),
}
type PerformanceTier = keyof typeof baselines

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const currentBuildSha = getChatbotBuildSha()
  const events = await prisma.chatbotAuditEvent.findMany({
    where: {
      eventName: "response_normalized",
      result: "success",
      buildSha: currentBuildSha,
    },
    select: { buildSha: true, tier: true, payloadJson: true },
    orderBy: { createdAt: "desc" },
    take: 40,
  })
  const validEvents = events.flatMap((event) => {
    if (event.buildSha !== currentBuildSha) return []
    if (!isPerformanceTier(event.tier)) return []
    const stageTimings = readStageTimings(event.payloadJson)
    return stageTimings ? [{ buildSha: event.buildSha, tier: event.tier, stageTimings }] : []
  })
  const latestScenarioEvents = (Object.keys(baselines) as PerformanceTier[]).flatMap((tier) =>
    validEvents.filter((event) => event.tier === tier).slice(0, minimumSampleCount),
  )
  const evaluation = evaluateChatbotPerformanceScenarios({
    baselines,
    samples: latestScenarioEvents.map((event) => ({ tier: event.tier, stageTimings: event.stageTimings })),
  })
  const report = {
    ok: evaluation.status === "within-budget",
    status: evaluation.status,
    sampleCount: evaluation.sampleCount,
    baselineBuildShas: Object.fromEntries(
      Object.entries(baselines).map(([tier, baseline]) => [tier, baseline.buildSha]),
    ),
    currentBuildSha,
    observedBuildShas: [...new Set(latestScenarioEvents.map((event) => event.buildSha))].sort(),
    violations: evaluation.violations,
    scenarios: evaluation.scenarios,
  }

  console.log("[chatbot-audit-health]", report)
  return NextResponse.json(report, { status: evaluation.status === "regressed" ? 503 : 200 })
}

function isPerformanceTier(value: string | null): value is PerformanceTier {
  return value !== null && value in baselines
}

function readStageTimings(payloadJson: string) {
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>
    const stageTimings = chatbotAuditStageTimingsSchema.safeParse(parsed.stageTimings)
    return stageTimings.success ? stageTimings.data : null
  } catch {
    return null
  }
}
