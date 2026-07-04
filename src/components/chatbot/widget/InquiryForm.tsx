"use client"

import { FormEvent, useState } from "react"

import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea"

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
  mode?: "tier4" | "consultation-summary"
  initialEmail?: string
  summaryText?: string
  openQuestions?: string[]
}

/**
 * The "[AI応答補助フォーム]" subject prefix is intentionally handled by the PR 10 API route.
 */
export function InquiryForm({
  onSubmit,
  mode = "tier4",
  initialEmail = "",
  summaryText,
  openQuestions = [],
}: InquiryFormProps) {
  const [input, setInput] = useState<InquiryFormInput>({
    name: "",
    email: initialEmail,
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
    if (!isValidEmail(normalizedInput.email)) return
    onSubmit(normalizedInput)
  }

  return (
    <form className="glass-card space-y-4 p-5" aria-label="問い合わせフォーム" onSubmit={handleSubmit}>
      <div>
        <p className="text-sm font-semibold text-hp">
          {mode === "consultation-summary" ? "相談内容を送信" : "問い合わせフォーム"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-hp-muted">
          {mode === "consultation-summary"
            ? "整理した相談内容をご連絡先のメールアドレス（必須）と一緒に送信します。"
            : "AI アシスタントが応答できない場合の連絡用フォームです。メールアドレスは必須です。"}
        </p>
      </div>
      {mode === "consultation-summary" && summaryText ? (
        <div className="glass-card-sm space-y-2 px-3 py-3 text-xs leading-relaxed text-hp-muted" aria-label="相談サマリ">
          <p className="font-semibold text-hp">相談サマリ</p>
          <p>{summaryText}</p>
          {openQuestions.length > 0 ? (
            <p>未確認: {openQuestions.join(" / ")}</p>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-1 text-xs font-semibold text-hp">
          <span className="flex items-center gap-2">
            氏名
            <span className="glass-badge px-2 py-0.5 text-[10px]">任意</span>
          </span>
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            value={input.name}
            onChange={(event) => updateInput("name", event.target.value)}
            aria-label="氏名"
          />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-hp">
          <span className="flex items-center gap-2">
            メールアドレス
            <span className="glass-badge px-2 py-0.5 text-[10px]">必須</span>
          </span>
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            type="email"
            value={input.email}
            onChange={(event) => updateInput("email", event.target.value)}
            required
            placeholder="例: client@example.com"
            aria-label="メールアドレス"
          />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-hp">
          <span className="flex items-center gap-2">
            案件種別
            <span className="glass-badge px-2 py-0.5 text-[10px]">任意</span>
          </span>
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            value={input.jobType}
            onChange={(event) => updateInput("jobType", event.target.value)}
            aria-label="案件種別"
          />
          <span className="block text-[11px] font-normal leading-relaxed text-hp-muted">
            T・Y案件 等イニシャルでも可
          </span>
        </label>
        <label className="block space-y-1 text-xs font-semibold text-hp">
          <span className="flex items-center gap-2">
            尺
            <span className="glass-badge px-2 py-0.5 text-[10px]">任意</span>
          </span>
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            value={input.duration}
            onChange={(event) => updateInput("duration", event.target.value)}
            aria-label="尺"
          />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-hp md:col-span-2">
          <span className="flex items-center gap-2">
            希望納期
            <span className="glass-badge px-2 py-0.5 text-[10px]">任意</span>
          </span>
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            value={input.desiredDeadline}
            onChange={(event) => updateInput("desiredDeadline", event.target.value)}
            aria-label="希望納期"
          />
        </label>
      </div>
      <label className="block space-y-1 text-xs font-semibold text-hp">
        <span className="flex items-center gap-2">
          自由記述
          <span className="glass-badge px-2 py-0.5 text-[10px]">任意</span>
        </span>
        <AutoResizeTextarea
          className="glass-input min-h-24 w-full px-3 py-2 text-sm"
          value={input.freeText}
          onChange={(event) => updateInput("freeText", event.target.value)}
          aria-label="自由記述"
        />
      </label>
      <button type="submit" className="glass-btn px-4 py-2 text-sm font-semibold text-hp">
        {mode === "consultation-summary" ? "相談内容を送信" : "送信"}
      </button>
    </form>
  )
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
}
