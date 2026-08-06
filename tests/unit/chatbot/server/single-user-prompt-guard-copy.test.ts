import { describe, expect, it } from "vitest"

import { buildSingleUserPromptGuardContent } from "@/lib/chatbot/server/prompt-guard-copy"

// The guard copy has to describe the UI the customer will actually see. Production conversation
// cmsi4g6d5000004kzsg5g7eqt rendered the Tier 3 inquiry form while the reply still read
// "下の選択肢から選んでください", so the customer was told to pick options that never appeared.
describe("single user prompt guard copy", () => {
  it("describes the inquiry form even when routing still wants a choice panel", () => {
    const guarded = buildSingleUserPromptGuardContent({
      routingDecision: {
        kind: "continue",
        nextQuestion: "まず案件種別を選んでください",
        presentChoices: {
          id: "job-kind",
          question: "まず案件種別を選んでください",
          choices: [
            { id: "web-cm", label: "Web CM / CM" },
            { id: "mv", label: "MV / 音楽映像" },
          ],
        },
      },
      uiKind: "tier3-inquiry-form",
    })

    expect(guarded?.reason).toBe("tier3-inquiry-form")
    expect(guarded?.content).not.toContain("選択肢")
    expect(guarded?.content).toContain("フォーム")
  })

  it("still uses the choice panel copy when a choice panel is what renders", () => {
    const guarded = buildSingleUserPromptGuardContent({
      routingDecision: {
        kind: "continue",
        nextQuestion: "まず案件種別を選んでください",
        presentChoices: {
          id: "job-kind",
          question: "まず案件種別を選んでください",
          choices: [
            { id: "web-cm", label: "Web CM / CM" },
            { id: "mv", label: "MV / 音楽映像" },
          ],
        },
      },
      uiKind: "choice-panel",
    })

    expect(guarded?.reason).toBe("choice-panel")
    expect(guarded?.content).toContain("下の選択肢から選んでください")
  })

  it("describes the booking card and summary form from the rendered UI", () => {
    expect(
      buildSingleUserPromptGuardContent({ routingDecision: undefined, uiKind: "booking-card" })?.reason,
    ).toBe("booking-card")
    expect(
      buildSingleUserPromptGuardContent({ routingDecision: undefined, uiKind: "consultation-summary-form" })?.reason,
    ).toBe("summary-form")
  })
})
