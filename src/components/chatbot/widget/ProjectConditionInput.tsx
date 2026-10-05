"use client"

import { useState } from "react"
import { formatConditionAnswer, type ConditionAnswer, type ProjectConditionDefinition } from "@/lib/booking/domain/project-conditions"
import { WorkCompositionInput } from "./WorkCompositionInput"
import { DeadlineInput } from "./DeadlineInput"

export type ConditionSubmission = { conditionId: string; answer: ConditionAnswer }

export function ProjectConditionInput({ definition, answer, onChange }: {
  definition: ProjectConditionDefinition
  answer: ConditionAnswer
  onChange: (answer: ConditionAnswer) => void
}) {
  const unknown = answer.status === "unknown"
  const update = (value: ConditionAnswer) => onChange({ ...value, status: "answered" })
  const inputClass = "glass-input min-h-11 w-full min-w-0 px-3 text-sm"
  let input

  if (definition.input === "composition") {
    input = <WorkCompositionInput initialRows={answer.composition} onChange={(composition) => update({ composition })} />
  } else if (definition.input === "date") {
    input = <DeadlineInput label={definition.label} value={unknown ? "未定" : answer.date ?? ""} onChange={(date) => onChange(date === "未定" || !date ? { status: "unknown" } : { status: "answered", date })} />
  } else if (definition.input === "single") {
    input = (
      <select aria-label={definition.label} className={inputClass} value={unknown ? "" : answer.selectedIds?.[0] ?? ""} onChange={(event) => onChange(event.target.value ? { status: "answered", selectedIds: [event.target.value] } : { status: "unknown" })}>
        <option value="">未確認</option>
        {definition.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    )
  } else if (definition.input === "multiple") {
    input = (
      <div className="flex flex-wrap gap-x-3 gap-y-1" role="group" aria-label={definition.label}>
        {definition.options.map((option) => (
          <label key={option.id} className="inline-flex min-h-11 items-center gap-2 text-sm text-hp">
            <input type="checkbox" checked={!unknown && (answer.selectedIds?.includes(option.id) ?? false)} onChange={(event) => {
              const ids = answer.selectedIds ?? []
              const selectedIds = event.target.checked
                ? option.id === "none" ? ["none"] : [...ids.filter((id) => id !== "none"), option.id]
                : ids.filter((id) => id !== option.id)
              update({ selectedIds, ...(selectedIds.includes("other") && answer.otherComment ? { otherComment: answer.otherComment } : {}) })
            }} />
            {option.label}
          </label>
        ))}
      </div>
    )
  } else {
    input = (
      <input aria-label={definition.label} className={inputClass} disabled={unknown} type={definition.input === "number" ? "number" : "text"} inputMode={definition.input === "number" ? "numeric" : undefined} min={0} step={1} maxLength={500} placeholder="未確認"
        value={definition.input === "number" ? answer.number ?? "" : definition.input === "dates" ? answer.dates?.join("、") ?? answer.text ?? "" : answer.text ?? ""}
        onChange={(event) => {
          const value = event.target.value
          if (definition.input === "number") {
            const number = Number(value)
            if (value === "" || (Number.isSafeInteger(number) && number >= 0)) update({ number: value === "" ? undefined : number })
          } else if (definition.input === "dates") update({ text: value })
          else update({ text: value })
        }} />
    )
  }

  return (
    <div className="min-w-0 space-y-2">
      <p className="text-sm font-medium text-hp">{definition.label}</p>
      {input}
      {(definition.allowFreeText || answer.selectedIds?.includes("other")) && (definition.input === "single" || definition.input === "multiple") ? (
        <input aria-label={`${definition.label}のその他コメント`} className={inputClass} value={answer.otherComment ?? ""} placeholder="その他コメント" onChange={(event) => update({ ...answer, otherComment: event.target.value })} />
      ) : null}
      {!["single", "date", "composition"].includes(definition.input) ? (
        <label className="inline-flex min-h-11 items-center gap-2 text-sm text-hp">
          <input type="checkbox" checked={unknown} onChange={(event) => onChange(event.target.checked ? { status: "unknown" } : { status: "answered" })} />未定
        </label>
      ) : null}
    </div>
  )
}

export function ProjectConditionCard({ definition, onSubmit }: {
  definition: ProjectConditionDefinition
  onSubmit: (message: string, submission: ConditionSubmission) => void
}) {
  const [answer, setAnswer] = useState<ConditionAnswer>({})
  const display = formatConditionAnswer(definition, answer)
  const hasAnswer = answer.status === "unknown" || Boolean(answer.text?.trim() || answer.date || answer.dates?.length || answer.selectedIds?.length || answer.composition?.length) || (answer.number !== undefined && Number.isSafeInteger(answer.number) && answer.number >= 0)
  const submit = () => onSubmit(`${definition.label}: ${answer.status === "unknown" ? "未定" : display}`, { conditionId: definition.id, answer })

  return (
    <section className="space-y-3 rounded-[12px] border border-white/55 bg-white/35 p-3" aria-label={`${definition.label}の入力`}>
      <ProjectConditionInput definition={definition} answer={answer} onChange={setAnswer} />
      <p className="text-xs leading-relaxed text-hp-muted" aria-live="polite">{display}</p>
      {definition.input === "composition" ? (
        <button type="button" className="glass-btn min-h-11 w-full px-3 text-sm" onClick={() => onSubmit(`${definition.label}: 未定`, { conditionId: definition.id, answer: { status: "unknown" } })}>未定で回答する</button>
      ) : null}
      <button type="button" className="glass-btn min-h-11 w-full px-3 text-sm disabled:opacity-50" disabled={!hasAnswer} onClick={submit}>{definition.label}を回答する</button>
    </section>
  )
}
