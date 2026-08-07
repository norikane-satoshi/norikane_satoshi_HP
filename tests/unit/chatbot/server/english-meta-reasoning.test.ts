import { describe, expect, it } from "vitest"

import { sanitizeChatbotLlmTextWithReport } from "@/lib/chatbot/server/llm-response-normalizer"

function outcome(body: string) {
  return sanitizeChatbotLlmTextWithReport(`<customer_reply>${body}</customer_reply>`).report.displayBoundary
    ?.outcome
}

// Scoping the English heuristic to explicit boundaries unblocked non-Japanese customers, but it
// also let reasoning through whenever the model avoided the words "user" or "customer". What marks
// those lines is meta-conversation vocabulary: they talk about which question to ask next and what
// is still missing, never about the customer's project.
describe("english reasoning that talks about the conversation", () => {
  it.each([
    "The medium is still unknown so the next question should cover it.",
    "Missing: final medium and deadline. Ask about the medium first.",
    "Okay, the job kind is confirmed. Next step is the duration.",
    "Based on the conversation so far, asking about additional work makes sense.",
    "Looking at the answers, I should confirm the delivery format next.",
  ])("discards %j", (body) => {
    expect(outcome(body)).toBe("fallback")
  })

  it.each([
    "Thank you for reaching out. For a 30-second commercial, colour grading usually takes about half a day to one day. Could you tell me which platform it will run on?",
    "For a 30-second web commercial with a locked edit, colour grading typically takes around 0.5 to 1 day. The exact turnaround can shift depending on source material condition, any additional work, delivery format, and desired deadline.",
    "I can help with that. Live concert footage of about 150 minutes usually takes seven to eight days.",
  ])("keeps a real English reply: %j", (body) => {
    expect(outcome(body)).toBe("adopted")
  })

  it("still discards the Japanese and machine-identifier leaks", () => {
    expect(outcome("ユーザーはまだ媒体を答えていないので、次に媒体を確認しよう。")).toBe("fallback")
    expect(outcome("I will now call show_booking_card with projectTitle set.")).toBe("fallback")
  })
})
