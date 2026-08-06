import { describe, expect, it } from "vitest"

import { sanitizeChatbotLlmTextWithReport } from "@/lib/chatbot/server/llm-response-normalizer"

function wrap(body: string): string {
  return `<customer_reply>${body}</customer_reply>`
}

describe("customer-facing text in languages other than Japanese", () => {
  it("keeps an English answer that the model marked as customer-facing", () => {
    const result = sanitizeChatbotLlmTextWithReport(
      wrap(
        "Thank you for reaching out. For a 30-second commercial, colour grading usually takes " +
          "about half a day to one day. I would need to know the final delivery medium. " +
          "Could you tell me which platform the commercial will run on?",
      ),
    )

    expect(result.report.displayBoundary?.outcome).toBe("adopted")
    expect(result.text).toContain("colour grading")
  })

  it("records the English prose heuristic as monitoring instead of discarding the reply", () => {
    const result = sanitizeChatbotLlmTextWithReport(wrap("I can help with that. Which platform will it run on?"))

    expect(result.report.displayBoundary?.outcome).toBe("adopted")
    expect(result.report.unsafeArtifacts?.fallbackApplied).not.toBe(true)
  })

  it("still discards a reply carrying a real internal artifact", () => {
    const withMachineIdentifier = sanitizeChatbotLlmTextWithReport(
      wrap("I will now call show_booking_card with projectTitle set."),
    )
    expect(withMachineIdentifier.report.displayBoundary?.outcome).toBe("fallback")

    const withThinkingMarker = sanitizeChatbotLlmTextWithReport(
      wrap("thinking: the customer has not given the medium yet, so I should ask."),
    )
    expect(withThinkingMarker.report.displayBoundary?.outcome).toBe("fallback")

    const withJapaneseMonologue = sanitizeChatbotLlmTextWithReport(
      wrap("ユーザーはまだ媒体を答えていないので、次に媒体を確認しよう。"),
    )
    expect(withJapaneseMonologue.report.displayBoundary?.outcome).toBe("fallback")
  })

  it("keeps discarding English reasoning that was never marked as customer-facing", () => {
    const result = sanitizeChatbotLlmTextWithReport(
      "Looking at the conversation, the user said the medium is web. I should ask about the deadline next.",
    )
    expect(result.report.displayBoundary?.outcome).toBe("fallback")
  })
})
