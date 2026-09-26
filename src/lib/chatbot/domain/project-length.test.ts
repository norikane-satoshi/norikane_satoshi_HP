import { describe, expect, it } from "vitest"

import { formatProjectLengthMinutes } from "@/lib/chatbot/domain"
import { buildBookingFinalConfirmationQuestion } from "@/lib/chatbot/server/flow-policy"

describe("project length display", () => {
  it("shows short CMs in seconds instead of fractional minutes", () => {
    expect(formatProjectLengthMinutes(0.25)).toBe("15秒")
    expect(formatProjectLengthMinutes(0.5)).toBe("30秒")
    expect(formatProjectLengthMinutes(1.5)).toBe("1分30秒")
    expect(formatProjectLengthMinutes(5)).toBe("5分")
    expect(formatProjectLengthMinutes(90)).toBe("1.5時間")
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
