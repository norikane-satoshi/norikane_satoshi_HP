"use client"

import { FormEvent, useState } from "react"

import type { RoutingDecision } from "@/lib/chatbot/domain/routing-decision"

type DirectContactReason = Extract<RoutingDecision, { kind: "to-direct-contact" }>["reason"]

type DirectContactCardProps = {
  reason: DirectContactReason
  suggestedMessage: string
  onSubmitEmail: (email: string, companyName: string, personName: string) => void
}

const reasonLabels: Record<DirectContactReason, string> = {
  "out-of-scope": "標準対応外",
  "tech-question": "技術相談",
  "review-request": "作品レビュー",
  "vfx-cg-heavy": "VFX / CG 主体",
  "tight-deadline": "短納期",
  "raw-edit-included": "編集反映あり",
  "heavy-retouch": "重めの修正",
  "plugin-detail": "詳細確認",
  complex: "個別確認",
}

export function DirectContactCard({ reason, suggestedMessage, onSubmitEmail }: DirectContactCardProps) {
  const [email, setEmail] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [personName, setPersonName] = useState("")

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail) return
    onSubmitEmail(trimmedEmail, companyName.trim(), personName.trim())
  }

  return (
    <section className="glass-inset space-y-4 p-4" aria-label="連絡誘導">
      <div>
        <p className="text-sm font-semibold text-hp">{reasonLabels[reason]}</p>
        <p className="mt-2 text-sm leading-relaxed text-hp-muted">{suggestedMessage}</p>
      </div>
      <form className="space-y-3" onSubmit={handleSubmit}>
        <label className="block space-y-1 text-xs font-semibold text-hp">
          メールアドレス
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            aria-label="メールアドレス"
          />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1 text-xs font-semibold text-hp">
            会社名
            <input
              className="glass-input w-full px-3 py-2 text-sm"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              aria-label="会社名"
            />
          </label>
          <label className="block space-y-1 text-xs font-semibold text-hp">
            お名前
            <input
              className="glass-input w-full px-3 py-2 text-sm"
              value={personName}
              onChange={(event) => setPersonName(event.target.value)}
              aria-label="お名前"
            />
          </label>
        </div>
        <button type="submit" className="glass-btn px-4 py-2 text-sm font-semibold text-hp">
          連絡内容を送る
        </button>
      </form>
    </section>
  )
}
