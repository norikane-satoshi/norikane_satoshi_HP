import { describe, expect, it } from "vitest"

import { formatConsultationSummary } from "@/lib/chatbot/domain/consultation-summary"
import { customerFacingWorkSiteChoices, workSiteChoices } from "@/lib/chatbot/domain/survey-choice"

describe("work-site choices", () => {
  it("offers the owner's studio first and the rooms away from it, never the client's facility", () => {
    expect(customerFacingWorkSiteChoices(new Date("2026-10-01T00:00:00+09:00")).choices.map((choice) => choice.label)).toEqual([
      "さとしさんのスタジオ",
      "ポスプロの部屋を借りる",
      "依頼元の機材部屋（制作会社など）",
      "依頼元が手配するレンタルスペース",
      "リモートグレーディング",
      "お任せ",
      "その他",
    ])
    expect(JSON.stringify(workSiteChoices)).not.toMatch(/クライアント施設|client-facility/u)
  })

  it("tells the owner which room the customer picked", () => {
    const summary = formatConsultationSummary({
      jobContext: {
        finalMedium: "cinema",
        jobKind: "feature-90m",
        projectLengthMinutes: 90,
        documentaryAttachment: { kind: "none" },
        workSite: "on-site",
      },
      conversationState: {
        hasFinalMedium: true,
        hasJobKind: true,
        hasProjectLength: true,
        hasAdditionalWork: false,
        hasDocumentaryAttachments: true,
        hasWorkSite: true,
        workSiteLabel: "依頼元の機材部屋（制作会社など）",
        hasReferenceUrls: false,
        hasContactEmail: false,
        hasDesiredSchedule: false,
        turnCount: 4,
      },
    })

    expect(summary).toContain("- 作業場所/立ち会い: 依頼元の機材部屋（制作会社など）")
  })
})
