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
  pricing: "料金確認",
  "contract-decision": "契約確認",
  "personal-life": "個人情報",
  "other-client": "他案件情報",
  "confidential-technique": "非公開情報",
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
      <div className="glass-card-sm space-y-1 px-3 py-3 text-xs leading-relaxed text-hp-muted" aria-label="送信前の整理内容">
        <p className="font-semibold text-hp">送信前の整理内容</p>
        <p>確認が必要な内容として、入力された相談内容と連絡先をのりかね本人へ送ります。</p>
        <p>送信ボタンを押すまでメールは送信されません。</p>
      </div>
      <form className="space-y-3" onSubmit={handleSubmit}>
        <label className="block space-y-1 text-xs font-semibold text-hp">
          <span className="flex items-center gap-2">
            メールアドレス
            <span className="glass-badge px-2 py-0.5 text-[10px]">必須</span>
          </span>
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
            <span className="flex items-center gap-2">
              会社名
              <span className="glass-badge px-2 py-0.5 text-[10px]">任意</span>
            </span>
            <input
              className="glass-input w-full px-3 py-2 text-sm"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              aria-label="会社名"
            />
          </label>
          <label className="block space-y-1 text-xs font-semibold text-hp">
            <span className="flex items-center gap-2">
              お名前
              <span className="glass-badge px-2 py-0.5 text-[10px]">任意</span>
            </span>
            <input
              className="glass-input w-full px-3 py-2 text-sm"
              value={personName}
              onChange={(event) => setPersonName(event.target.value)}
              aria-label="お名前"
            />
          </label>
        </div>
        <button type="submit" className="glass-btn px-4 py-2 text-sm font-semibold text-hp">
          この内容で送信
        </button>
      </form>
    </section>
  )
}
