"use client"

import { useState } from "react"
import type { WorkCompositionRow } from "@/lib/booking/domain/work-composition"
import { ProjectDurationInput } from "./ProjectDurationInput"

export function WorkCompositionInput({ initialRows, onChange }: {
  initialRows?: WorkCompositionRow[]
  onChange: (rows: WorkCompositionRow[]) => void
}) {
  const [rows, setRows] = useState<WorkCompositionRow[]>(() => initialRows?.length ? initialRows : [{ count: 1 }])
  const [keys, setKeys] = useState(() => rows.map((_, index) => index))
  const [nextKey, setNextKey] = useState(rows.length)
  const update = (next: WorkCompositionRow[]) => { setRows(next); onChange(next) }
  const updateRow = (index: number, value: Partial<WorkCompositionRow>) => update(rows.map((row, position) => position === index ? { ...row, ...value } : row))
  return (
    <fieldset aria-label="作品構成" className="min-w-0 space-y-3">
      {rows.map((row, index) => (
        <div key={keys[index]} className="space-y-2 rounded-[12px] border border-white/55 bg-white/35 p-3" role="group" aria-label={`作品${index + 1}`}>
          <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
            <label className="text-xs text-hp-muted">名称（任意）<input aria-label={`作品${index + 1}の名称`} className="glass-input mt-1 min-h-11 w-full min-w-0 px-2 text-sm" value={row.name ?? ""} maxLength={80} onChange={(event) => updateRow(index, { name: event.target.value || undefined })} /></label>
            <label className="text-xs text-hp-muted">本数<input aria-label={`作品${index + 1}の本数`} className="glass-input mt-1 min-h-11 w-full px-2 text-sm" type="number" inputMode="numeric" min={1} step={1} value={row.count} onChange={(event) => { const count = Number(event.target.value); if (Number.isSafeInteger(count) && count > 0) updateRow(index, { count }) }} /></label>
          </div>
          <ProjectDurationInput initialSeconds={row.durationSeconds} onChange={(minutes) => updateRow(index, { durationSeconds: minutes === undefined ? undefined : Math.round(minutes * 60) })} />
          {rows.length > 1 ? <button type="button" aria-label={`作品${index + 1}を削除`} className="glass-btn min-h-11 px-3 text-xs" onClick={() => { setKeys(keys.filter((_, position) => position !== index)); update(rows.filter((_, position) => position !== index)) }}>削除</button> : null}
        </div>
      ))}
      <button type="button" className="glass-btn min-h-11 w-full px-3 text-sm" onClick={() => { setKeys([...keys, nextKey]); setNextKey(nextKey + 1); update([...rows, { count: 1 }]) }}>作品を追加</button>
    </fieldset>
  )
}
