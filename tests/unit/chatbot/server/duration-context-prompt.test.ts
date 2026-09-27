import { describe, expect, it } from "vitest"

import type { JobContext } from "@/lib/chatbot/domain"
import { buildWorkflowPromptContext, provideWorkflowEstimate } from "@/lib/chatbot/server/duration-context"

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
