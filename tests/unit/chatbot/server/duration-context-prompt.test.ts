import { describe, expect, it } from "vitest"

import type { ChatbotConversation, JobContext } from "@/lib/chatbot/domain"
import { buildWorkflowPromptContext, provideWorkflowEstimate, resolveWorkflowDurationContext } from "@/lib/chatbot/server/duration-context"

function context(overrides: Partial<JobContext>): JobContext {
  return provideWorkflowEstimate({
    jobKind: "mv-5m",
    projectLengthMinutes: 5,
    finalMedium: "web",
    workSite: "remote-grading",
    documentaryAttachment: { kind: "none" },
    ...overrides,
  })
}

describe("workflow prompt context", () => {
  it("does not bring up strict deliveries until the customer names one", () => {
    const prompt = buildWorkflowPromptContext(context({})) ?? ""

    expect(prompt).not.toMatch(/NHK|OTT|Netflix|Disney|1日多め/u)
  })

  it("states the extra QC day once the customer has named an NHK or OTT delivery", () => {
    const prompt = buildWorkflowPromptContext(context({ strictDeliveryClient: true })) ?? ""

    expect(prompt).toContain("QC を1日多めに勧めている")
    expect(prompt).toContain("QC 1日（納品先の検査に合わせて1日多め）")
  })
})


describe("customer duration evidence", () => {
  const conversation = (contents: string[]): ChatbotConversation => ({
    id: "c", status: "open", startedAt: "2026-10-05", updatedAt: "2026-10-05",
    context: { sessionId: "s", jobContext: { jobKind: "feature-90m", projectLengthMinutes: 60 } },
    messages: contents.map((content, index) => ({ id: String(index), role: "user", content, createdAt: "2026-10-05" })),
  })
  it.each([["尺: 0時間18分", 18], ["尺: 1時間18分", 78], ["尺: 未定", undefined], ["未定", undefined], ["尺: 約18分", undefined], ["尺: 15〜20分", undefined]] as const)("uses the latest customer correction %s", (latestUserMessage, minutes) => {
    const c = conversation(["尺: 2時間0分"])
    c.context.currentQuestion = "作品の尺を時間・分で入力してください。"
    const result = resolveWorkflowDurationContext({ conversation: c, latestUserMessage })
    expect(result.jobContext.projectLengthMinutes).toBe(minutes)
    if (minutes === undefined) {
      expect(result.jobContext.workflowEstimate).toMatchObject({ estimateStatus: "needs-confirmation", unsupportedReason: "project-length-unconfirmed", stages: [] })
      expect(result.promptContext).toContain("尺: 未確認")
    }
  })
  it("never turns input or stored numeric estimates and assistant guesses into customer duration", () => {
    const c = conversation([])
    c.messages.push({ id: "guess", role: "assistant", content: "尺は1時間18分ですね", createdAt: "2026-10-05" })
    const result = resolveWorkflowDurationContext({ conversation: c, inputJobContext: { projectLengthMinutes: 90 } })
    expect(result.jobContext.projectLengthMinutes).toBeUndefined()
    expect(result.jobContext.workflowEstimate?.unsupportedReason).toBe("project-length-unconfirmed")
  })
})
