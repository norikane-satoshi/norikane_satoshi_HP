import { NextRequest, NextResponse } from "next/server"

import baselineData from "@/lib/chatbot/audit/performance-baseline.json"
import { chatbotAuditStageTimingsSchema } from "@/lib/chatbot/audit/contract"
import {
  chatbotPerformanceBaselineSchema,
  evaluateChatbotPerformanceWindow,
} from "@/lib/chatbot/audit/performance"
import { getChatbotBuildSha } from "@/lib/chatbot/server/build-info"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const minimumSampleCount = 5
const baseline = chatbotPerformanceBaselineSchema.parse(baselineData)

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
    select: { buildSha: true, payloadJson: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  })
  const validEvents = events.flatMap((event) => {
    if (event.buildSha !== currentBuildSha) return []
    const stageTimings = readStageTimings(event.payloadJson)
    return stageTimings ? [{ buildSha: event.buildSha, stageTimings }] : []
  }).slice(0, minimumSampleCount)
  const evaluation = evaluateChatbotPerformanceWindow({
    baseline,
    samples: validEvents.map((event) => event.stageTimings),
  })
  const report = {
    ok: evaluation.status === "within-budget",
    status: evaluation.status,
    sampleCount: evaluation.sampleCount,
    baselineBuildSha: baseline.buildSha,
    currentBuildSha,
    observedBuildShas: [...new Set(validEvents.map((event) => event.buildSha))].sort(),
    violations: evaluation.violations,
    observedP95Ms: evaluation.observedP95Ms,
  }

  console.log("[chatbot-audit-health]", report)
  return NextResponse.json(report, { status: evaluation.status === "regressed" ? 503 : 200 })
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
