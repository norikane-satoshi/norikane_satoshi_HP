"use client"

import { useState } from "react"

import type { SurveyChoiceSet } from "@/lib/chatbot/domain/survey-choice"

type ChoicePanelProps = {
  choiceSet: SurveyChoiceSet
  onSelect: (selectedIds: string[]) => void
  allowMultiple?: boolean
}

export function ChoicePanel({ choiceSet, onSelect, allowMultiple = false }: ChoicePanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const handleSelect = (choiceId: string) => {
    const nextSelectedIds = allowMultiple
      ? toggleMultipleChoice(selectedIds, choiceId)
      : [choiceId]

    setSelectedIds(nextSelectedIds)
    if (!allowMultiple) onSelect(nextSelectedIds)
  }

  return (
    <section className="glass-inset space-y-3 p-4" aria-label={choiceSet.question}>
      <p className="text-sm font-semibold text-hp">{choiceSet.question}</p>
      <div className="flex flex-wrap gap-2">
        {choiceSet.choices.map((choice) => {
          const isSelected = selectedIds.includes(choice.id)
          if (allowMultiple) {
            return (
              <label
                key={choice.id}
                className={[
                  "glass-btn inline-flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold",
                  isSelected ? "border-[var(--accent-primary)] text-hp" : "text-hp-muted",
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[var(--accent-primary)]"
                  checked={isSelected}
                  onChange={() => handleSelect(choice.id)}
                />
                <span>{choice.label}</span>
              </label>
            )
          }

          return (
            <button
              key={choice.id}
              type="button"
              onClick={() => handleSelect(choice.id)}
              className={[
                "glass-btn px-3 py-2 text-xs font-semibold",
                isSelected ? "border-[var(--accent-primary)] text-hp" : "text-hp-muted",
              ].join(" ")}
              aria-pressed={isSelected}
            >
              {choice.label}
            </button>
          )
        })}
      </div>
      {allowMultiple ? (
        <button
          type="button"
          className="glass-btn px-4 py-2 text-xs font-semibold text-hp disabled:cursor-not-allowed disabled:opacity-45"
          disabled={selectedIds.length === 0}
          onClick={() => onSelect(selectedIds)}
        >
          選択内容を送信
        </button>
      ) : null}
    </section>
  )
}

function toggleMultipleChoice(selectedIds: string[], choiceId: string): string[] {
  if (choiceId === "none") return selectedIds.includes("none") ? [] : ["none"]

  const withoutNone = selectedIds.filter((id) => id !== "none")
  return withoutNone.includes(choiceId)
    ? withoutNone.filter((id) => id !== choiceId)
    : [...withoutNone, choiceId]
}
