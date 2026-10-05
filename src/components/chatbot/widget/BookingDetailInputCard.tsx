"use client"

import { useState } from "react"

export function BookingDetailInputCard({ label, onSubmit }: { label: "納品形式" | "DCP作成担当"; onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("")
  const [unknown, setUnknown] = useState(false)
  return (
    <section className="space-y-3 rounded-[12px] border border-white/55 bg-white/35 p-3" aria-label={`${label}の入力`}>
      <label className="block text-sm font-medium text-hp">{label}<input aria-label={label} value={value} disabled={unknown} onChange={(event) => setValue(event.target.value)} className="glass-input mt-2 w-full min-w-0 px-3 py-2" maxLength={160} placeholder={label === "納品形式" ? "例：ProRes 422 HQ、Rec.709" : "依頼予定のポスプロ・担当者など"} /></label>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm text-hp"><input type="checkbox" checked={unknown} onChange={(event) => setUnknown(event.target.checked)} />未定</label>
      <button type="button" className="glass-btn min-h-11 w-full px-3 py-2 text-sm" disabled={!unknown && !value.trim()} onClick={() => onSubmit(`${label}: ${unknown ? "未定" : value.trim()}`)}>{label}を回答する</button>
    </section>
  )
}
