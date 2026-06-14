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
      ? selectedIds.includes(choiceId)
        ? selectedIds.filter((id) => id !== choiceId)
        : [...selectedIds, choiceId]
      : [choiceId]

    setSelectedIds(nextSelectedIds)
    onSelect(nextSelectedIds)
  }

  return (
    <section className="glass-inset space-y-3 p-4" aria-label={choiceSet.question}>
      <p className="text-sm font-semibold text-hp">{choiceSet.question}</p>
      <div className="flex flex-wrap gap-2">
        {choiceSet.choices.map((choice) => {
          const isSelected = selectedIds.includes(choice.id)
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
    </section>
  )
}
