import { describe, expect, it } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import {
  getMissingBookingReadinessSlots,
} from "@/lib/chatbot/server/flow-policy"
import { applyMaterialHandoffAnswer } from "@/lib/chatbot/server/material-handoff"
import { decideRoutingFallback } from "@/lib/chatbot/server/routing"

function readyState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    hasFinalMedium: true,
    hasJobKind: true,
    hasProjectLength: true,
    hasMaterialHandoff: false,
    hasMaterialDetails: false,
    hasMaterialTiming: false,
    hasAdditionalWork: true,
    hasDocumentaryAttachments: true,
    hasWorkSite: true,
    hasReferenceUrls: true,
    hasContactEmail: true,
    hasDesiredSchedule: false,
    contactEmail: "client@example.jp",
    turnCount: 8,
    ...overrides,
  }
}

const jobContext: JobContext = {
  jobKind: "live-60m",
  finalMedium: "youtube",
  projectLengthMinutes: 90,
  workSite: "remote-grading",
  documentaryAttachment: { kind: "none" },
}

describe("material ready date", () => {
  it.each(["2026-10-15", "未定"])("stores only an explicit ready date or unknown: %s", (answer) => {
    const result = applyMaterialHandoffAnswer({ conversationState: readyState(), previousAssistantMessage: "編集確定版の素材が揃う日を選んでください。", latestUserMessage: `素材が揃う日: ${answer}` })
    expect(result).toMatchObject({ hasMaterialTiming: true, materialHandoff: { timing: answer === "未定" ? "未確認" : answer } })
    expect(result.hasMaterialDetails).toBe(false)
    expect(result.hasMaterialHandoff).toBe(false)
  })
  it.each(["来週", "2026-02-30", "どう送ればいいですか？"])("rejects a non-date answer: %s", (answer) => {
    const state = readyState()
    expect(applyMaterialHandoffAnswer({ conversationState: state, previousAssistantMessage: "素材が揃う日を教えてください", latestUserMessage: answer })).toBe(state)
  })
  it("requires the ready date but never material contents or handoff method", () => {
    const state = readyState({ hasDeliveryFormat: true })
    expect(decideRoutingFallback({ jobContext, conversationState: state })).toMatchObject({ kind: "continue", presentChoices: { id: "material-timing" } })
    expect(getMissingBookingReadinessSlots(state, { jobContext })).toContain("material-timing")
    expect(getMissingBookingReadinessSlots(state, { jobContext })).not.toContain("material-contents")
    expect(getMissingBookingReadinessSlots(state, { jobContext })).not.toContain("material-method")
  })
})
