import { expect, it } from "vitest"
import { matchChoiceAnswer } from "./choice-answer"
const single = { id: "single", question: "選択", choices: [{ id: "web", label: "Web公開" }, { id: "other", label: "その他" }] }
it.each(["Web公開", "選択: Web公開", "選択：Web公開"])("matches old single syntax %s", (text) => {
  expect(matchChoiceAnswer(single, text)?.selectedIds).toEqual(["web"])
})
it("matches multiple labels and other comment without interpreting free text", () => {
  const panel = { ...single, selectionMode: "multiple" as const }
  expect(matchChoiceAnswer(panel, "選択: Web公開、その他\nその他コメント: 補足です")).toMatchObject({ selectedIds: ["web", "other"], otherComment: "補足です" })
  expect(matchChoiceAnswer(panel, "Web公開について相談したい")).toBeUndefined()
  expect(matchChoiceAnswer(panel, "選択: Web公開、不明な選択肢")).toBeUndefined()
  expect(matchChoiceAnswer(single, "選択: Web公開、その他")).toBeUndefined()
})
