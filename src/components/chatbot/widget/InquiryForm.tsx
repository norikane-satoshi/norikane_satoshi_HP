"use client"

import { FormEvent, useState } from "react"

import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea"
import type { InquiryFormPrefill } from "@/lib/chatbot/domain"
import {useChatbotCopy} from "./i18n"

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
  mode?: "tier3" | "consultation-summary"
  initialEmail?: string
  initialValues?: InquiryFormPrefill
  summaryText?: string
  openQuestions?: string[]
}

/**
 * The "[AI応答補助フォーム]" subject prefix is intentionally handled by the PR 10 API route.
 */
export function InquiryForm({
  onSubmit,
  mode = "tier3",
  initialEmail = "",
  initialValues = {},
  summaryText,
  openQuestions = [],
}: InquiryFormProps) {
  const copy = useChatbotCopy()
  const [input, setInput] = useState<InquiryFormInput>({
    name: initialValues.name ?? "",
    email: initialValues.email ?? initialEmail,
    jobType: initialValues.jobType ?? "",
    duration: initialValues.duration ?? "",
    desiredDeadline: initialValues.desiredDeadline ?? "",
    freeText: initialValues.freeText ?? "",
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
    <form className="glass-card space-y-4 p-5" aria-label={copy.inquiryForm} onSubmit={handleSubmit}>
      <div>
        <p className="text-sm font-semibold text-hp">
          {mode === "consultation-summary" ? copy.sendConsultation : copy.inquiryForm}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-hp-muted">
          {mode === "consultation-summary"
            ? copy.consultationIntro
            : copy.inquiryIntro}
        </p>
      </div>
      {mode === "consultation-summary" && summaryText ? (
        <div className="glass-card-sm space-y-2 px-3 py-3 text-xs leading-relaxed text-hp-muted" aria-label={copy.consultationSummary}>
          <p className="font-semibold text-hp">{copy.consultationSummary}</p>
          <p>{summaryText}</p>
          {openQuestions.length > 0 ? (
            <p>{copy.unconfirmed.replace("{items}", openQuestions.join(" / "))}</p>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-1 text-xs font-semibold text-hp">
          <span className="flex items-center gap-2">
            {copy.name}
            <span className="glass-badge px-2 py-0.5 text-[10px]">{copy.optional}</span>
          </span>
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            value={input.name}
            onChange={(event) => updateInput("name", event.target.value)}
            aria-label={copy.name}
          />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-hp">
          <span className="flex items-center gap-2">
            {copy.email}
            <span className="glass-badge px-2 py-0.5 text-[10px]">{copy.required}</span>
          </span>
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            type="email"
            value={input.email}
            onChange={(event) => updateInput("email", event.target.value)}
            required
            placeholder={copy.emailPlaceholder}
            aria-label={copy.email}
          />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-hp">
          <span className="flex items-center gap-2">
            {copy.jobType}
            <span className="glass-badge px-2 py-0.5 text-[10px]">{copy.optional}</span>
          </span>
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            value={input.jobType}
            onChange={(event) => updateInput("jobType", event.target.value)}
            aria-label={copy.jobType}
          />
          <span className="block text-[11px] font-normal leading-relaxed text-hp-muted">
            {copy.jobTypeHint}
          </span>
        </label>
        <label className="block space-y-1 text-xs font-semibold text-hp">
          <span className="flex items-center gap-2">
            {copy.duration}
            <span className="glass-badge px-2 py-0.5 text-[10px]">{copy.optional}</span>
          </span>
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            value={input.duration}
            onChange={(event) => updateInput("duration", event.target.value)}
            aria-label={copy.duration}
          />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-hp md:col-span-2">
          <span className="flex items-center gap-2">
            {copy.desiredDeadline}
            <span className="glass-badge px-2 py-0.5 text-[10px]">{copy.optional}</span>
          </span>
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            value={input.desiredDeadline}
            onChange={(event) => updateInput("desiredDeadline", event.target.value)}
            aria-label={copy.desiredDeadline}
          />
        </label>
      </div>
      <label className="block space-y-1 text-xs font-semibold text-hp">
        <span className="flex items-center gap-2">
          {copy.freeText}
          <span className="glass-badge px-2 py-0.5 text-[10px]">{copy.optional}</span>
        </span>
        <AutoResizeTextarea
          className="glass-input min-h-24 w-full px-3 py-2 text-sm"
          value={input.freeText}
          onChange={(event) => updateInput("freeText", event.target.value)}
          aria-label={copy.freeText}
        />
      </label>
      <button type="submit" className="glass-btn px-4 py-2 text-sm font-semibold text-hp">
        {mode === "consultation-summary" ? copy.sendConsultation : copy.send}
      </button>
    </form>
  )
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
}
