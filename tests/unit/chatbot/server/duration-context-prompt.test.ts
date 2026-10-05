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

  it("keeps internal estimates out of the customer prompt even for strict deliveries", () => {
    const prompt = buildWorkflowPromptContext(context({ strictDeliveryClient: true })) ?? ""

    expect(prompt).not.toMatch(/QC|工程|\d+日/u)
  })
})


describe("customer duration evidence", () => {
  const conversation = (): ChatbotConversation => ({
    id: "c", status: "open", startedAt: "2026-10-05", updatedAt: "2026-10-05",
    context: { sessionId: "s", jobContext: { jobKind: "feature", projectLengthMinutes: 60 } },
    messages: [{ id: "user", role: "user", content: "古い表示では90分", createdAt: "2026-10-05" }],
  })
  it("uses the structured customer composition instead of message wording or stale numeric values", () => {
    const c = conversation()
    c.context.conversationState = { conditionAnswers: { "project-length": { status: "answered", composition: [{ count: 2, durationSeconds: 30 }, { count: 1, durationSeconds: 15 }], sourceMessageId: "user" } } }
    const result = resolveWorkflowDurationContext({ conversation: c, inputJobContext: { projectLengthMinutes: 90 } })
    expect(result.jobContext.projectLengthMinutes).toBe(1.25)
  })
  it("keeps unknown row durations unconfirmed", () => {
    const c = conversation()
    c.context.conversationState = { conditionAnswers: { "project-length": { status: "answered", composition: [{ count: 2 }], sourceMessageId: "user" } } }
    const result = resolveWorkflowDurationContext({ conversation: c })
    expect(result.jobContext.projectLengthMinutes).toBeUndefined()
    expect(result.jobContext.workflowEstimate?.unsupportedReason).toBe("project-length-unconfirmed")
  })
  it("accepts a newly validated active composition before persistence", () => {
    const result = resolveWorkflowDurationContext({ conversation: conversation(), activeChoiceJobContext: { projectLengthMinutes: 18 } })
    expect(result.jobContext.projectLengthMinutes).toBe(18)
  })
  it("never turns input or stored numeric estimates and message guesses into customer duration", () => {
    const c = conversation()
    c.messages.push({ id: "guess", role: "assistant", content: "尺は1時間18分ですね", createdAt: "2026-10-05" })
    const result = resolveWorkflowDurationContext({ conversation: c, inputJobContext: { projectLengthMinutes: 90 }, latestUserMessage: "Web CM 30秒です" })
    expect(result.jobContext.projectLengthMinutes).toBeUndefined()
    expect(result.jobContext.workflowEstimate?.unsupportedReason).toBe("project-length-unconfirmed")
  })
})
