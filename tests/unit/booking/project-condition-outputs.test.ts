import { describe, expect, it } from "vitest"
import { bookingDetailsMemo, confirmedBookingDetails, displayBookingDetails } from "@/lib/chatbot/domain/booking-details"
import { buildBookingConfirmedEmail, buildChatbotBookingOwnerNotification } from "@/lib/booking/server/email"
import type { ConditionAnswers } from "@/lib/booking/domain/project-conditions"

const common: ConditionAnswers = {
  "delivery-format": { text: "ProRes 422 HQ、Rec.709" },
  "desired-delivery-date": { date: "2026-10-25" },
  "delivery-date-reason": { text: "映画祭への応募" },
  "material-timing": { status: "unknown" },
  "work-site": { selectedIds: ["remote-grading"] },
}
const scenarios: Array<{ title: string; answers: ConditionAnswers; expected: string[]; omitted: string[] }> = [
  {
    title: "短編ドキュメンタリー",
    answers: {
      ...common, "job-kind": { selectedIds: ["documentary"] },
      "project-length": { composition: [{ name: "短編ドキュメンタリー", count: 1, durationSeconds: 1080 }] },
      "final-medium": { selectedIds: ["cinema"] }, "dcp-required": { selectedIds: ["not-required"] },
    },
    expected: ["作品構成: 短編ドキュメンタリー 1本 × 18分", "尺: 18分", "DCP必要性: 不要"],
    omitted: ["DCP作成担当:"],
  },
  {
    title: "CM",
    answers: {
      ...common, "job-kind": { selectedIds: ["cm"] },
      "project-length": { composition: [{ name: "CM", count: 3, durationSeconds: 30 }] },
      "final-medium": { selectedIds: ["web"] },
    },
    expected: ["作品構成: CM 3本 × 30秒", "尺: 1分30秒"],
    omitted: ["DCP必要性:", "DCP作成担当:"],
  },
  {
    title: "ライブ",
    answers: {
      ...common, "job-kind": { selectedIds: ["live"] },
      "project-length": { composition: [{ name: "ライブ本編", count: 1, durationSeconds: 7200 }, { name: "メイキング", count: 1, durationSeconds: 1200 }] },
      "final-medium": { selectedIds: ["ott"] }, "additional-work": { selectedIds: ["retouch"] },
      "retouch-cut-count": { status: "unknown" },
    },
    expected: ["作品構成: ライブ本編 1本 × 2時間 / メイキング 1本 × 20分", "尺: 2時間20分", "修正カット数: 未確認"],
    omitted: ["DCP必要性:", "DCP作成担当:"],
  },
]

describe("shared project conditions across booking outputs", () => {
  it.each(scenarios)("$title is identical in review, receipt, notification and calendar memo", ({ title, answers, expected, omitted }) => {
    const details = confirmedBookingDetails({ conversationState: { conditionAnswers: answers } })
    const review = displayBookingDetails(details).map(({ label, value }) => `${label}: ${value}`)
    const memo = bookingDetailsMemo("", details)
    const receipt = buildBookingConfirmedEmail({
      to: "test@example.com", projectTitle: title, workScopes: [], memo,
    })
    const owner = buildChatbotBookingOwnerNotification({
      bookingGroupId: "test-group", contactName: "テスト相談者", contactEmail: "test@example.com",
      projectTitle: title, selectedSlots: [], memo, submittedAt: "2026-10-05T13:00:00Z",
    })
    for (const line of review) {
      expect(receipt.lines.filter((value) => value === line), line).toHaveLength(1)
      expect(owner.lines.filter((value) => value === line), line).toHaveLength(1)
      expect(memo.split("\n").filter((value) => value === line), line).toHaveLength(1)
    }
    for (const line of expected) {
      expect(review).toContain(line)
      expect(receipt.text).toContain(line)
      expect(owner.text).toContain(line)
      expect(memo).toContain(line)
    }
    for (const prefix of omitted) {
      for (const output of [receipt.text, owner.text, memo]) expect(output).not.toContain(prefix)
    }
    expect(receipt.text).toContain("納品希望日: 2026/10/25(日)")
    expect(owner.text).toContain("納品希望日: 2026/10/25(日)")
    expect(memo).toContain("納品希望日: 2026/10/25(日)")
    expect(receipt.subject).toContain("【ご相談受付】")
    for (const output of [receipt.text, owner.text, memo]) expect(output).not.toMatch(/作業日数|立ち会い日数|工程目安/)
  })
})
