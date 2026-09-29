"use client"

import { useState } from "react"

import { isCalendarDate, isSelectableDeadline, todayInJapan } from "@/lib/chatbot/domain/deadline"

/** Native date picker supplements free text, including undecided/consultation answers. */
export function DeadlineInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <input
        type="date"
        aria-label="納期をカレンダーで選ぶ"
        className="glass-input w-full min-w-0 px-3 py-2 text-sm text-hp"
        min={todayInJapan()}
        value={isCalendarDate(value) ? value : ""}
        onChange={(event) => {
          if (isSelectableDeadline(event.target.value)) onChange(event.target.value)
        }}
      />
      <input
        aria-label="納期"
        className="glass-input w-full px-3 py-2 text-sm text-hp"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="例：11月20日 / 10月末ごろ / 年内 / 未定"
      />
    </div>
  )
}

export function DeadlinePanel({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("")
  const valid = value.trim() && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || isSelectableDeadline(value))
  return (
    <section className="space-y-2 rounded-[12px] border border-white/55 bg-white/35 p-3" aria-label="納期の日付選択">
      <DeadlineInput value={value} onChange={setValue} />
      <button type="button" className="glass-btn px-3 py-2 text-sm" disabled={!valid} onClick={() => onSubmit(`納期: ${value.trim()}`)}>納期を送信</button>
      {["未定", "相談したい"].map((answer) => <button key={answer} type="button" className="glass-btn px-3 py-2 text-sm" onClick={() => onSubmit(`納期: ${answer}`)}>{answer}</button>)}
    </section>
  )
}
