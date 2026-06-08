import { describe, expect, it } from "vitest"

import {
  formatConsultationSummary,
  hasRequiredConsultationNotificationSlots,
} from "@/lib/chatbot/domain/consultation-summary"

describe("consultation summary", () => {
  it("formats collected job context and contact fields in Japanese", () => {
    const summary = formatConsultationSummary({
      jobContext: {
        finalMedium: "web",
        jobKind: "cm-30s",
        workSite: "remote-grading",
        documentaryAttachment: { kind: "interview", count: 2 },
        additionalWork: ["retouch", "skin-retouch"],
        projectLengthMinutes: 4,
        preferredStartDate: "2026-06-15",
        publicReleaseDate: "2026-06-30",
      },
      conversationState: {
        hasFinalMedium: true,
        hasJobKind: true,
        hasProjectLength: true,
        hasAdditionalWork: true,
        hasDocumentaryAttachments: true,
        hasWorkSite: true,
        hasDesiredSchedule: true,
        hasContactEmail: true,
        contactEmail: "client@example.com",
        customerName: "田中",
        companyName: "株式会社サンプル",
        turnCount: 4,
      },
    })

    expect(summary).toContain("最終媒体: Web")
    expect(summary).toContain("- 案件種別: CM 30秒")
    expect(summary).toContain("- 追加作業: レタッチ / 肌レタッチ")
    expect(summary).toContain("- 付随素材: インタビュー 2件")
    expect(summary).toContain("- 作業場所/立ち会い: リモート")
    expect(summary).toContain("- メール: client@example.com")
  })

  it("marks missing fields as 未取得", () => {
    const summary = formatConsultationSummary({
      conversationState: {
        hasFinalMedium: false,
        hasJobKind: false,
        hasProjectLength: false,
        hasAdditionalWork: false,
        hasDocumentaryAttachments: false,
        hasWorkSite: false,
        hasDesiredSchedule: false,
        hasContactEmail: false,
        turnCount: 1,
      },
    })

    expect(summary).toContain("最終媒体: 未取得")
    expect(summary).toContain("- 案件種別: 未取得")
    expect(summary).toContain("- 作業場所/立ち会い: 未取得")
    expect(summary).toContain("- メール: 未取得")
  })

  it("requires the major slots and an actual contact email before chat-completed notification", () => {
    expect(
      hasRequiredConsultationNotificationSlots({
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasProjectLength: true,
          hasMaterialHandoff: true,
          hasWorkSite: true,
          hasDesiredSchedule: true,
          hasContactEmail: true,
          contactEmail: "client@example.com",
        },
      }),
    ).toBe(true)

    expect(
      hasRequiredConsultationNotificationSlots({
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasProjectLength: true,
          hasWorkSite: true,
          hasDesiredSchedule: true,
          hasContactEmail: true,
        },
      }),
    ).toBe(false)

    expect(
      hasRequiredConsultationNotificationSlots({
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasProjectLength: true,
          hasWorkSite: true,
          hasDesiredSchedule: true,
          hasContactEmail: true,
          contactEmail: "client@example.com",
        },
      }),
    ).toBe(false)
  })
})
