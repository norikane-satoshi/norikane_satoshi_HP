import { describe, expect, it } from "vitest"

import { formatProjectLengthMinutes, parseProjectLengthMinutes } from "@/lib/chatbot/domain"
import { buildBookingFinalConfirmationQuestion } from "@/lib/chatbot/server/flow-policy"

describe("project length display", () => {
  it("shows short CMs in seconds instead of fractional minutes", () => {
    expect(formatProjectLengthMinutes(0.25)).toBe("15秒")
    expect(formatProjectLengthMinutes(0.5)).toBe("30秒")
    expect(formatProjectLengthMinutes(1.5)).toBe("1分30秒")
    expect(formatProjectLengthMinutes(5)).toBe("5分")
    expect(formatProjectLengthMinutes(90)).toBe("1時間30分")
    expect(formatProjectLengthMinutes(120)).toBe("2時間")
  })

  it("reads a 15-second CM as 15秒 in the final confirmation", () => {
    const question = buildBookingFinalConfirmationQuestion(
      { jobKind: "cm-30s", finalMedium: "youtube", workSite: "remote-grading", documentaryAttachment: { kind: "none" }, projectLengthMinutes: 0.25 },
      { hasFinalMedium: true, hasJobKind: true, hasProjectLength: true, hasAdditionalWork: true, hasDocumentaryAttachments: true, hasWorkSite: true, hasReferenceUrls: true, hasContactEmail: true, hasDesiredSchedule: true, turnCount: 10 },
    )
    expect(question).toContain("尺は15秒")
    expect(question).not.toContain("0.25")
  })
})


describe("exact customer duration parsing", () => {
  it.each([["尺: 0時間18分", 18], ["1時間18分", 78], ["２時間３０分", 150], ["15秒", 0.25], ["2時間半", 150]] as const)("parses %s", (text, minutes) => {
    expect(parseProjectLengthMinutes(text)).toBe(minutes)
  })
  it.each(["尺: 未定", "未確認", "90分前後", "1〜2時間", "約18分", "2.5", "0時間0分", "-18分", "18分以上"])("does not guess %s", (text) => {
    expect(parseProjectLengthMinutes(text)).toBeUndefined()
  })
})
