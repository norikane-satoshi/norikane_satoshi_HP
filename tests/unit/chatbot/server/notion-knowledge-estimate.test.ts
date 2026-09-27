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
  it("follows the synced live lines now that the sync reads each row's total", () => {
    const snapshot = createStaticChatbotKnowledgeSnapshot("2026-09-27T00:00:00.000Z")
    snapshot.workflowDurations.presets = snapshot.workflowDurations.presets.map((preset) =>
      preset.id === "live-60m"
        ? { ...preset, minDays: 5, maxDays: 5, source: "notion-sync" as const }
        : preset.id === "live-150m"
          ? { ...preset, minDays: 8, maxDays: 9, source: "notion-sync" as const }
          : preset,
    )

    const at60 = estimateWorkflow(jobContext({ projectLengthMinutes: 60 }), { knowledgeSnapshot: snapshot })
    const at150 = estimateWorkflow(jobContext({ projectLengthMinutes: 150 }), { knowledgeSnapshot: snapshot })

    expect([at60.totalMinDays, at60.totalMaxDays]).toEqual([5, 5])
    expect([at150.totalMinDays, at150.totalMaxDays]).toEqual([8, 9])
  })

  it("uses the corrected live 60m 4 day estimate without a synced snapshot", () => {
    const result = estimateWorkflow(jobContext({ projectLengthMinutes: 60 }))

    expect(result.totalMinDays).toBe(4)
    expect(result.totalMaxDays).toBe(4)
  })
})
