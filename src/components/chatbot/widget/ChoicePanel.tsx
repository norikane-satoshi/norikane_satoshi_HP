"use client"

import { useState } from "react"
import { Check } from "lucide-react"

import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea"
import type { SurveyChoiceSet } from "@/lib/chatbot/domain/survey-choice"
import {
  CHATBOT_CONVERSATION_CONTENT_CLASS_NAME,
  CHATBOT_CONVERSATION_CONTENT_STYLE,
} from "./conversationTypography"

export type ChoicePanelSelection = {
  selectedIds: string[]
  selectedLabels: string[]
  otherComment?: string
}

type ChoicePanelProps = {
  choiceSet: SurveyChoiceSet
  onSelect: (selection: ChoicePanelSelection) => void
  allowMultiple?: boolean
}

export function ChoicePanel({ choiceSet, onSelect, allowMultiple = false }: ChoicePanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [otherComment, setOtherComment] = useState("")
  const hasOtherSelected = selectedIds.includes("other")
  const needsConfirm = allowMultiple || hasOtherSelected

  const handleSelect = (choiceId: string) => {
    const nextSelectedIds = allowMultiple
      ? toggleMultipleChoice(selectedIds, choiceId)
      : [choiceId]

    setSelectedIds(nextSelectedIds)
    if (!nextSelectedIds.includes("other")) {
      setOtherComment("")
    }
    if (!allowMultiple && choiceId !== "other") {
      submitSelection(nextSelectedIds, "")
    }
  }

  const handleConfirm = () => {
    if (selectedIds.length === 0) return
    submitSelection(selectedIds, otherComment)
  }

  const submitSelection = (ids: string[], comment: string) => {
    const labels = choiceSet.choices.filter((choice) => ids.includes(choice.id)).map((choice) => choice.label)
    onSelect({
      selectedIds: ids,
      selectedLabels: labels,
      ...(ids.includes("other") && comment.trim() ? { otherComment: comment.trim() } : {}),
    })
  }

  return (
    <section className="glass-inset space-y-3 p-4" aria-label={choiceSet.question}>
      <p
        className={`${CHATBOT_CONVERSATION_CONTENT_CLASS_NAME} text-sm text-hp`}
        style={CHATBOT_CONVERSATION_CONTENT_STYLE}
      >
        {choiceSet.question}
      </p>
      <div className="flex flex-wrap gap-2">
        {choiceSet.choices.map((choice) => {
          const isSelected = selectedIds.includes(choice.id)
          return (
            <button
              key={choice.id}
              type="button"
              onClick={() => handleSelect(choice.id)}
              className={[
                "glass-btn inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold",
                isSelected
                  ? "border-[var(--accent-primary)] bg-white/75 text-hp ring-2 ring-[var(--hp-color-chatbot-choice-ring)]"
                  : "text-hp-muted",
              ].join(" ")}
              aria-pressed={isSelected}
            >
              {isSelected ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-[var(--accent-primary)]" /> : null}
              {choice.label}
            </button>
          )
        })}
      </div>
      {hasOtherSelected ? (
        <label className="block space-y-1 text-xs font-semibold text-hp">
          <span>その他の内容</span>
          <AutoResizeTextarea
            value={otherComment}
            onChange={(event) => setOtherComment(event.target.value)}
            rows={3}
            className="glass-input min-h-20 w-full px-3 py-2 text-sm font-medium text-hp placeholder:text-hp-muted/70"
            placeholder="補足があれば入力してください"
          />
        </label>
      ) : null}
      {needsConfirm ? (
        <button
          type="button"
          onClick={handleConfirm}
          disabled={selectedIds.length === 0}
          className="glass-btn px-3 py-2 text-xs font-semibold text-hp disabled:cursor-not-allowed disabled:opacity-50"
        >
          選択を送信
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
