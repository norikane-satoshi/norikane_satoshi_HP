"use client"

import { useState } from "react"
import { isCalendarDate, isSelectableDeadline, todayInJapan } from "@/lib/chatbot/domain/deadline"

export function DeadlineInput({ value, onChange, label = "納期" }: { value: string; onChange: (value: string) => void; label?: string }) {
  return (
    <div className="space-y-2">
      <input type="date" aria-label={`${label}をカレンダーで選ぶ`} className="glass-input w-full min-w-0 px-3 py-2 text-sm text-hp" min={todayInJapan()} value={isCalendarDate(value) ? value : ""} disabled={value === "未定"} onChange={(event) => {
        if (!event.target.value || isSelectableDeadline(event.target.value)) onChange(event.target.value)
      }} />
      <label className="inline-flex min-h-11 items-center gap-2 text-sm font-normal text-hp">
        <input type="checkbox" aria-label={`${label}は未定`} checked={value === "未定"} onChange={(event) => onChange(event.target.checked ? "未定" : "")} />未定
      </label>
    </div>
  )
}

export function DateAnswerPanel({ label, onSubmit }: { label: string; onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("")
  const [reason, setReason] = useState("")
  const deadline = label === "納期"
  const valid = value === "未定" || isSelectableDeadline(value)
  return (
    <section className="space-y-3 rounded-[12px] border border-white/55 bg-white/35 p-3" aria-label={`${label}の日付選択`}>
      <p className="text-sm font-medium text-hp">{label}</p>
      <DeadlineInput label={label} value={value} onChange={setValue} />
      {deadline && isCalendarDate(value) ? <label className="block text-sm text-hp">動かせない理由があれば（任意）<input aria-label="納品希望日の理由" value={reason} onChange={(event) => setReason(event.target.value)} className="glass-input mt-2 w-full px-3 py-2" placeholder="映画祭・公開日など" maxLength={160} /></label> : null}
      <button type="button" className="glass-btn min-h-11 w-full px-3 py-2 text-sm" disabled={!valid} onClick={() => onSubmit(`${label}: ${value}${deadline && isCalendarDate(value) && reason.trim() ? `\n納品希望日の理由: ${reason.trim()}` : ""}`)}>{label}を回答する</button>
    </section>
  )
}

export function DeadlinePanel({ onSubmit }: { onSubmit: (text: string) => void }) {
  return <DateAnswerPanel label="納期" onSubmit={onSubmit} />
}
