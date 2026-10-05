"use client"

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
