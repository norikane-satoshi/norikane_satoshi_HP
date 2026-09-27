import { describe, expect, it } from "vitest"

import type { JobContext } from "@/lib/chatbot/domain"
import { estimateWorkflow } from "@/lib/chatbot/server/duration-estimator"
import { createStaticChatbotKnowledgeSnapshot } from "@/lib/chatbot/server/notion-knowledge-sync"

function jobContext(overrides: Partial<JobContext>): JobContext {
  return {
    jobKind: "live-60m",
    finalMedium: "live",
    workSite: "satoshi-studio",
    documentaryAttachment: { kind: "none" },
    ...overrides,
  }
}

describe("chatbot duration estimator synced knowledge", () => {
  it("keeps live anchors fixed even when an old synced snapshot has stale live-60m days", () => {
    const snapshot = createStaticChatbotKnowledgeSnapshot("2026-06-19T00:00:00.000Z")
    snapshot.workflowDurations.presets = snapshot.workflowDurations.presets.map((preset) =>
      preset.id === "live-60m"
        ? { ...preset, minDays: 8, maxDays: 9, source: "notion-sync" }
        : preset,
    )

    const result = estimateWorkflow(jobContext({ projectLengthMinutes: 60 }), { knowledgeSnapshot: snapshot })

    expect(result.totalMinDays).toBe(4)
    expect(result.totalMaxDays).toBe(4)
  })

  it("uses the corrected live 60m 4 day estimate without a synced snapshot", () => {
    const result = estimateWorkflow(jobContext({ projectLengthMinutes: 60 }))

    expect(result.totalMinDays).toBe(4)
    expect(result.totalMaxDays).toBe(4)
  })
})
