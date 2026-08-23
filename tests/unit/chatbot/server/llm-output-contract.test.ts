import { describe, expect, it } from "vitest"

import {
  assertChatbotLlmResponseContract,
  createChatbotLlmResponse,
  getChatbotLlmOutputContractRejection,
  type ChatbotLlmResponse,
  type ChatbotLlmTier,
} from "@/lib/chatbot/server/llm-client"

function response(tier: ChatbotLlmTier, rawText: string): ChatbotLlmResponse {
  return createChatbotLlmResponse({
    rawText,
    tier,
  })
}

function choicePanel(overrides: Record<string, unknown> = {}): string {
  return `<customer_reply>案件を確認します。\n${JSON.stringify({
    tool: "show_choice_panel",
    args: {
      id: "job-kind",
      question: "案件の種類を教えてください",
      choices: [
        { id: "feature-film", label: "商業映画" },
        { id: "other", label: "その他" },
      ],
      ...overrides,
    },
  })}</customer_reply>`
}

function rejectionFor(rawText: string) {
  try {
    assertChatbotLlmResponseContract(response("tier-2-gemini-flash", rawText))
  } catch (error) {
    return getChatbotLlmOutputContractRejection(error)
  }
  return undefined
}

describe("shared chatbot LLM output contract", () => {
  it("creates display text and structured UI payload at the same boundary", () => {
    const result = response("tier-1-hosted-chrome-notion-ai", choicePanel())

    expect(result.displayEnvelope).toMatchObject({
      displayText: "案件を確認します。",
      uiPayload: {
        kind: "choice-panel",
        choiceSet: { id: "job-kind", question: "案件の種類を教えてください" },
      },
    })
  })

  it("accepts a Tier1 body response", () => {
    expect(() =>
      assertChatbotLlmResponseContract(
        response("tier-1-hosted-chrome-notion-ai", "<customer_reply>相談内容を確認しました。</customer_reply>"),
      ),
    ).not.toThrow()
  })

  it("accepts a Tier2 body response", () => {
    expect(() =>
      assertChatbotLlmResponseContract(
        response("tier-1-hosted-chrome-notion-ai", "<customer_reply>相談内容を確認しました。</customer_reply>"),
      ),
    ).not.toThrow()
  })

  it("accepts a Tier3 response with a valid choice panel", () => {
    expect(() =>
      assertChatbotLlmResponseContract(response("tier-2-gemini-flash", choicePanel())),
    ).not.toThrow()
  })

  it("accepts a Tier3 response with a booking card", () => {
    const rawText =
      '<customer_reply>候補日を確認します。\n{"tool":"show_booking_card","args":{}}</customer_reply>'
    expect(() =>
      assertChatbotLlmResponseContract(response("tier-2-gemini-flash", rawText)),
    ).not.toThrow()
  })

  it("rejects a Tier2 body-only response for deterministic same-tier UI repair", () => {
    expect(rejectionFor("<customer_reply>相談内容を確認しました。</customer_reply>")).toMatchObject({
      decision: "reject-and-regenerate-structured-ui",
      reason: "missing-structured-ui",
    })
  })

  it("rejects a choice panel with an unregistered id", () => {
    expect(rejectionFor(choicePanel({ id: "unknown" }))).toMatchObject({
      decision: "reject-and-regenerate-structured-ui",
      reason: "choice-set-id-not-allowlisted",
    })
  })

  it("rejects a choice panel with a question longer than 140 characters", () => {
    expect(rejectionFor(choicePanel({ question: "あ".repeat(141) }))).toMatchObject({
      reason: "choice-set-question-too-long",
    })
  })

  it("rejects a choice panel with fewer than two choices", () => {
    expect(
      rejectionFor(choicePanel({ choices: [{ id: "other", label: "その他" }] })),
    ).toMatchObject({ reason: "choice-set-choice-count-out-of-range" })
  })

  it("rejects a choice panel with more than ten choices", () => {
    const choices = Array.from({ length: 11 }, (_, index) => ({
      id: `choice-${index + 1}`,
      label: `候補${index + 1}`,
    }))
    expect(rejectionFor(choicePanel({ choices }))).toMatchObject({
      reason: "choice-set-choice-count-out-of-range",
    })
  })
})
