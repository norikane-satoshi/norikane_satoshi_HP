import { expect, it, vi } from "vitest"
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
import { recoverHistoricalChoiceAnswer } from "../message-handler"
import * as choices from "@/lib/chatbot/domain/survey-choice"
import type { ChatbotConversation, SurveyChoiceSet } from "@/lib/chatbot/domain"
const conversation = (): ChatbotConversation => ({ id: "c", startedAt: "2026-09-29", updatedAt: "2026-09-29", status: "open", context: { sessionId: "s" }, messages: [] })
function answer(c: ChatbotConversation, panel: SurveyChoiceSet, text: string) {
  c.messages.push({ id: `a${c.messages.length}`, role: "assistant", content: panel.question, createdAt: "2026-09-29T00:00:00Z" })
  const id = `u${c.messages.length}`
  c.messages.push({ id, role: "user", content: text, createdAt: "2026-09-29T00:00:01Z" })
  return id
}
it("replays old opening and multiple selections without saved answer metadata", () => {
  const c = conversation()
  const first = answer(c, choices.jobKindChoices, "映画 / 長編 / 本編")
  expect(recoverHistoricalChoiceAnswer(c, first)?.selectedIds).toEqual(["feature-90m"])
  answer(c, choices.projectLengthChoices, "尺: 1時間30分")
  const target = answer(c, choices.finalMediumChoices, "選択: Web公開、劇場公開")
  c.context.jobContext = { jobKind: "cm-30s" } // Later state must not affect replay.
  expect(recoverHistoricalChoiceAnswer(c, target)?.selectedIds).toEqual(["web", "cinema"])
})
it.each(["Web公開のことで相談です", "選択: 知らない選択肢"])("keeps free text or mismatch as text: %s", (text) => {
  const c = conversation()
  const id = answer(c, choices.finalMediumChoices, text)
  expect(recoverHistoricalChoiceAnswer(c, id)).toBeUndefined()
})
