import type { ChoiceAnswer } from "./conversation"
import type { SurveyChoiceSet } from "./survey-choice"

/** Exact label matching only: no substring, semantic inference, or free-text interpretation. */
export function matchChoiceAnswer(choiceSet: SurveyChoiceSet, content: string): ChoiceAnswer | undefined {
  const parts = content.trim().split(/\nその他(?:コメント|の内容)?\s*[:：]\s*/u)
  if (parts.length > 2) return undefined
  const text = parts[0].replace(/^選択\s*[:：]\s*/u, "").trim()
  const parse = (remaining: string, ids: string[]): string[] | undefined => {
    for (const choice of choiceSet.choices) {
      if (ids.includes(choice.id)) continue
      if (remaining === choice.label) return [...ids, choice.id]
      if (choiceSet.selectionMode !== "multiple") continue
      for (const separator of ["、", ", "]) {
        const prefix = choice.label + separator
        if (remaining.startsWith(prefix)) {
          const result = parse(remaining.slice(prefix.length), [...ids, choice.id])
          if (result) return result
        }
      }
    }
    return undefined
  }
  const selectedIds = parse(text, [])
  if (!selectedIds || (selectedIds.includes("none") && selectedIds.length > 1)) return undefined
  if (parts.length === 2 && !selectedIds.includes("other")) return undefined
  return {
    choiceSet,
    selectedIds,
    selectedLabels: selectedIds.map((id) => choiceSet.choices.find((choice) => choice.id === id)!.label),
    ...(parts[1]?.trim() ? { otherComment: parts[1].trim() } : {}),
  }
}
