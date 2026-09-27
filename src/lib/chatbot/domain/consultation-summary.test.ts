import { describe, expect, it } from "vitest"

import {
  formatConsultationSummary,
  hasRequiredConsultationNotificationSlots,
  hasRequiredEmailConsultationSlots,
} from "@/lib/chatbot/domain/consultation-summary"

describe("formatConsultationSummary", () => {
  it("includes other comments from choice panels", () => {
    const summary = formatConsultationSummary({
      jobContext: {
        finalMedium: "other",
        jobKind: "live-60m",
        projectLengthMinutes: 60,
        additionalWork: ["other"],
        documentaryAttachment: { kind: "other", count: 1, note: "舞台裏の短尺あり" },
        workSite: "remote-grading",
        referenceUrls: ["https://example.com/reference"],
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
        hasProductionOptions: true,
        productionOptions: ["captions", "other"],
        otherChoiceComments: {
          "final-medium": "展示会場上映",
          "additional-work": "MA も相談したい",
          "production-options": "英語版ナレーション",
        },
        contactEmail: "client@example.com",
        bookingPrefill: {
          projectTitle: "テスト案件",
          memo: "HDR版も相談",
        },
        turnCount: 8,
      },
    })

    expect(summary).toContain("最終媒体: その他（展示会場上映）")
    expect(summary).toContain("- 追加作業: その他（MA も相談したい）")
    expect(summary).toContain("- 付随素材: その他 1件（舞台裏の短尺あり）")
    expect(summary).toContain("- 字幕・テロップ等: 字幕 / その他（英語版ナレーション）")
    expect(summary).toContain("- 案件名: テスト案件")
    expect(summary).toContain("- 参考URL: https://example.com/reference")
    expect(summary).toContain("- その他の補足: HDR版も相談")
  })

  it("requires what, when, and how before production handoff notifications", () => {
    const state = {
      hasFinalMedium: true,
      hasJobKind: true,
      hasProjectLength: true,
      hasMaterialDetails: true,
      hasMaterialTiming: false,
      hasMaterialHandoff: true,
      hasWorkSite: true,
      hasDesiredSchedule: true,
      hasContactEmail: true,
      contactEmail: "client@example.com",
    }

    expect(hasRequiredConsultationNotificationSlots({ conversationState: state })).toBe(false)
    expect(hasRequiredEmailConsultationSlots({ conversationState: state })).toBe(false)
    expect(
      hasRequiredConsultationNotificationSlots({
        conversationState: { ...state, hasMaterialTiming: true },
      }),
    ).toBe(true)
    expect(
      hasRequiredEmailConsultationSlots({
        conversationState: { ...state, hasMaterialTiming: true },
      }),
    ).toBe(true)
  })
})
