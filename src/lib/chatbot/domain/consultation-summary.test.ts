import { describe, expect, it } from "vitest"

import {
  formatConsultationSummary,
  hasRequiredConsultationNotificationSlots,
  hasRequiredEmailConsultationSlots,
} from "@/lib/chatbot/domain/consultation-summary"

describe("formatConsultationSummary", () => {
  it("shares only explicit customer facts, with unanswered items unconfirmed", () => {
    const summary = formatConsultationSummary({
      messages: [{ id: "u", role: "user", content: "最終媒体: 展示会場上映\n納品形式: ProRes 422 HQ Rec.709\nDCP必要性: 不要", createdAt: "2026-10-05" }],
      jobContext: { jobKind: "feature-90m", projectLengthMinutes: 90, workSite: "satoshi-studio" },
      conversationState: { hasJobKind: true, hasProjectLength: true, hasWorkSite: true },
    })
    expect(summary).toContain("納品形式: ProRes 422 HQ Rec.709")
    expect(summary).toContain("尺: 未確認")
    expect(summary).not.toMatch(/立ち会い日数|受け渡し方法|工程日数/u)
  })

  it("requires delivery format and material readiness before notifications", () => {
    const state = {
      hasFinalMedium: true,
      hasJobKind: true,
      hasProjectLength: true,
      hasDeliveryFormat: true,
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


it("keeps the customer's explicit project name and supplemental text", () => {
  const content = "案件名: 作品A\n補足: 試写会の予定があります"
  const result = formatConsultationSummary({ messages: [{ id: "u", role: "user", content, createdAt: "2026-10-05T01:00:00Z" }] })
  expect(result).toContain("案件名: 作品A")
  expect(result).toContain("その他の補足: 試写会の予定があります")
})
