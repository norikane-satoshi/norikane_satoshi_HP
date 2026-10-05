import { describe, expect, it } from "vitest"

import { formatConsultationSummary } from "@/lib/chatbot/domain/consultation-summary"
import { customerFacingWorkSiteChoices, workSiteChoices } from "@/lib/chatbot/domain/survey-choice"

describe("work-site choices", () => {
  it("offers only the four customer attendance choices", () => {
    expect(customerFacingWorkSiteChoices().choices.map((choice) => choice.label)).toEqual(["オンライン", "先方の場所で", "不要", "お任せ"])
    expect(JSON.stringify(workSiteChoices)).not.toMatch(/スタジオ|自室/u)
  })
  it("keeps the exact customer attendance method in the summary", () => {
    expect(formatConsultationSummary({ messages: [{ id: "u", role: "user", content: "作業場所/立ち会い: 先方の場所で", createdAt: "2026-10-05" }] })).toContain("作業場所/立ち会い: 先方の場所で")
  })
})

describe("booking confirmation items", () => {
  it("lists customer answers and marks unanswered conditions as unconfirmed", async () => {
    const { buildBookingConfirmationItems } = await import("@/lib/chatbot/domain/consultation-summary")
    const items = buildBookingConfirmationItems({
      messages: [{ id: "answer", role: "user", content: "追加作業: なし\n参考URL: なし", createdAt: "2026-10-05T01:00:00Z" }],
      jobContext: {
        finalMedium: "web",
        jobKind: "cm-30s",
        projectLengthMinutes: 0.5,
        documentaryAttachment: { kind: "none" },
        workSite: "remote-grading",
      },
      conversationState: {
        hasFinalMedium: true,
        hasJobKind: true,
        hasProjectLength: true,
        hasAdditionalWork: true,
        hasDocumentaryAttachments: true,
        hasWorkSite: true,
        hasReferenceUrls: true,
        hasContactEmail: true,
        hasDesiredSchedule: false,
        contactEmail: "client@example.com",
        turnCount: 8,
      },
    })

    expect(items).toContainEqual({ label: "追加作業", value: "なし" })
    expect(items).toContainEqual({ label: "参考URL", value: "なし" })
    expect(items.map((item) => item.label)).not.toContain("メール")
    expect(items).toContainEqual({ label: "納品希望日", value: "未確認" })
    expect(items).toContainEqual({ label: "尺", value: "未確認" })
  })
})
