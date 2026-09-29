import { expect, it, vi } from "vitest"
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
import { recoverHistoricalChoiceAnswer } from "../message-handler"
import { createStaticChatbotKnowledgeSnapshot } from "../notion-knowledge-sync"
import { buildAttendanceDaysChoices } from "../attendance-days"
import { estimateWorkflow } from "../duration-estimator"
import * as choices from "@/lib/chatbot/domain/survey-choice"
import type { ChatbotConversation, JobContext, SurveyChoiceSet } from "@/lib/chatbot/domain"
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
  answer(c, choices.featureProjectLengthChoices, "選択: 90分前後")
  const target = answer(c, choices.finalMediumChoices, "選択: Web公開、劇場公開")
  c.context.jobContext = { jobKind: "cm-30s" } // Later state must not affect replay.
  expect(recoverHistoricalChoiceAnswer(c, target)?.selectedIds).toEqual(["web", "cinema"])
})
it("recomputes a dynamic attendance panel from the prefix", () => {
  const c = conversation()
  const sequence: Array<[SurveyChoiceSet, string]> = [
    [choices.jobKindChoices, "映画 / 長編 / 本編"], [choices.featureProjectLengthChoices, "90分前後"],
    [choices.finalMediumChoices, "Web公開"], [choices.additionalWorkChoices, "なし"],
    [choices.documentaryAttachmentChoices, "なし"], [choices.workSiteChoices, "リモートグレーディング"],
    [choices.materialContentsChoices, "書き出し済みの映像"], [choices.materialTimingChoices, "1週間以内"],
    [choices.materialHandoffMethodChoices, "アップローダー"], [choices.referenceUrlChoices, "なし"],
  ]
  for (const [panel, text] of sequence) answer(c, panel, `選択: ${text}`)
  const knowledge = createStaticChatbotKnowledgeSnapshot()
  const job: JobContext = { jobKind: "feature-90m", projectLengthMinutes: 90, finalMedium: "web", workSite: "remote-grading", documentaryAttachment: { kind: "none" } }
  const panel = buildAttendanceDaysChoices(job, estimateWorkflow(job, { knowledgeSnapshot: knowledge }))
  const selected = panel.choices[1]
  const id = answer(c, panel, `選択: ${selected.label}`)
  expect(recoverHistoricalChoiceAnswer(c, id, knowledge)).toMatchObject({ choiceSet: panel, selectedIds: [selected.id] })
})
it.each(["Web公開のことで相談です", "選択: 知らない選択肢"])("keeps free text or mismatch as text: %s", (text) => {
  const c = conversation()
  const id = answer(c, choices.finalMediumChoices, text)
  expect(recoverHistoricalChoiceAnswer(c, id)).toBeUndefined()
})
