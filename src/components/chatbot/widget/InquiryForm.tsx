"use client"

import { FormEvent, useState } from "react"

type InquiryFormInput = {
  name: string
  email: string
  jobType: string
  duration: string
  desiredDeadline: string
  freeText: string
}

type InquiryFormProps = {
  onSubmit: (input: InquiryFormInput) => void
}

/**
 * The "[LLM 障害時フォーム]" subject prefix is intentionally handled by the PR 10 API route.
 */
export function InquiryForm({ onSubmit }: InquiryFormProps) {
  const [input, setInput] = useState<InquiryFormInput>({
    name: "",
    email: "",
    jobType: "",
    duration: "",
    desiredDeadline: "",
    freeText: "",
  })

  const updateInput = (key: keyof InquiryFormInput, value: string) => {
    setInput((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedInput = {
      name: input.name.trim(),
      email: input.email.trim(),
      jobType: input.jobType.trim(),
      duration: input.duration.trim(),
      desiredDeadline: input.desiredDeadline.trim(),
      freeText: input.freeText.trim(),
    }
    if (!normalizedInput.name || !normalizedInput.email) return
    onSubmit(normalizedInput)
  }

  return (
    <form className="glass-card space-y-4 p-5" aria-label="問い合わせフォーム" onSubmit={handleSubmit}>
      <div>
        <p className="text-sm font-semibold text-hp">問い合わせフォーム</p>
        <p className="mt-1 text-xs leading-relaxed text-hp-muted">
          AI アシスタントが応答できない場合の連絡用フォームです。
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-1 text-xs font-semibold text-hp">
          氏名
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            value={input.name}
            onChange={(event) => updateInput("name", event.target.value)}
            required
            aria-label="氏名"
          />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-hp">
          メール
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            type="email"
            value={input.email}
            onChange={(event) => updateInput("email", event.target.value)}
            required
            aria-label="メール"
          />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-hp">
          案件種別
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            value={input.jobType}
            onChange={(event) => updateInput("jobType", event.target.value)}
            aria-label="案件種別"
          />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-hp">
          尺
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            value={input.duration}
            onChange={(event) => updateInput("duration", event.target.value)}
            aria-label="尺"
          />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-hp md:col-span-2">
          希望納期
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            value={input.desiredDeadline}
            onChange={(event) => updateInput("desiredDeadline", event.target.value)}
            aria-label="希望納期"
          />
        </label>
      </div>
      <label className="block space-y-1 text-xs font-semibold text-hp">
        自由記述
        <textarea
          className="glass-input min-h-24 w-full px-3 py-2 text-sm"
          value={input.freeText}
          onChange={(event) => updateInput("freeText", event.target.value)}
          aria-label="自由記述"
        />
      </label>
      <button type="submit" className="glass-btn px-4 py-2 text-sm font-semibold text-hp">
        送信
      </button>
    </form>
  )
}
