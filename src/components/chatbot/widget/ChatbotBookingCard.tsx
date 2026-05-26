"use client"

import { FormEvent, useMemo, useState } from "react"

import { DemoStage } from "@/components/chatbot/demo"
import { ChatbotLoginCard } from "@/components/chatbot/widget/ChatbotLoginCard"
import { mapErrorCodeToJa } from "@/lib/booking/domain/api-schema"
import { bookingOnboardingDemoScript } from "@/lib/chatbot/demo"
import type { CandidateWindow, WorkflowEstimate } from "@/lib/chatbot/domain/workflow-estimate"

type BookingResult = {
  bookingGroupId: string
  bookingIds?: string[]
}

type ChatbotBookingCardProps = {
  conversationId?: string
  estimate?: WorkflowEstimate
  candidates: CandidateWindow[]
  defaultProjectTitle?: string
  defaultContactName?: string
  defaultCompanyName?: string
  defaultDueDate?: string
  defaultMemo?: string
  showDemo?: boolean
  onBooked?: (result: BookingResult) => void
  onRequireLogin?: () => void
}

type ApiResponse = {
  error?: string
  bookingGroupId?: string
  bookingIds?: string[]
}

const API_PATH = "/api/chatbot/create-booking-from-chat"

function parseApiResponse(value: unknown): ApiResponse {
  if (!value || typeof value !== "object") return {}
  return value as ApiResponse
}

function estimateText(estimate?: WorkflowEstimate): string | null {
  if (!estimate) return null
  return `工程目安 ${estimate.totalMinDays}〜${estimate.totalMaxDays} 日`
}

export function ChatbotBookingCard({
  conversationId,
  estimate,
  candidates,
  defaultProjectTitle = "",
  defaultContactName = "",
  defaultCompanyName = "",
  defaultDueDate = "",
  defaultMemo = "",
  showDemo = false,
  onBooked,
  onRequireLogin,
}: ChatbotBookingCardProps) {
  const topCandidates = useMemo(() => candidates.slice(0, 3), [candidates])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(topCandidates.length === 1 ? 0 : null)
  const [projectTitle, setProjectTitle] = useState(defaultProjectTitle)
  const [dueDate, setDueDate] = useState(defaultDueDate)
  const [companyName, setCompanyName] = useState(defaultCompanyName)
  const [contactName, setContactName] = useState(defaultContactName)
  const [phone, setPhone] = useState("")
  const [memo, setMemo] = useState(defaultMemo)
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loginRequired, setLoginRequired] = useState(false)
  const [booked, setBooked] = useState<BookingResult | null>(null)

  const selectedSlot = selectedIndex === null ? null : topCandidates[selectedIndex] ?? null
  const canSubmit = Boolean(selectedSlot && projectTitle.trim() && contactName.trim() && agreed && !submitting)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit || !selectedSlot) return

    setSubmitting(true)
    setErrorMessage(null)
    setLoginRequired(false)

    try {
      const response = await fetch(API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          projectTitle: projectTitle.trim(),
          contactName: contactName.trim(),
          companyName: companyName.trim(),
          phone: phone.trim(),
          dueDate,
          memo: memo.trim(),
          agreed,
          selectedSlot: {
            start: selectedSlot.start,
            end: selectedSlot.end,
          },
          workflowEstimate: estimate,
        }),
      })
      const payload = parseApiResponse(await response.json().catch(() => ({})))

      if (response.status === 401) {
        setLoginRequired(true)
        setErrorMessage("ログインして予約に進んでください")
        onRequireLogin?.()
        return
      }

      if (!response.ok) {
        setErrorMessage(mapErrorCodeToJa(payload.error ?? "unknown"))
        return
      }

      if (!payload.bookingGroupId) {
        setErrorMessage(mapErrorCodeToJa("unknown"))
        return
      }

      const result = {
        bookingGroupId: payload.bookingGroupId,
        bookingIds: payload.bookingIds,
      }
      setBooked(result)
      onBooked?.(result)
    } catch {
      setErrorMessage(mapErrorCodeToJa("unknown"))
    } finally {
      setSubmitting(false)
    }
  }

  const body = (
    <section className="glass-card space-y-5 p-5" aria-label="チャット内予約">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-hp-muted">Booking</p>
        <h2 className="mt-1 text-base font-semibold text-hp">候補日時から予約する</h2>
        <p className="mt-2 text-sm leading-relaxed text-hp-muted">
          日程が決まっている場合は、候補を選んで予約内容を送信できます。
        </p>
        {estimateText(estimate) ? (
          <p className="mt-2 text-xs font-medium text-hp-muted">{estimateText(estimate)}</p>
        ) : null}
      </div>

      {booked ? (
        <div className="glass-inset space-y-2 p-4" role="status">
          <p className="text-sm font-semibold text-hp">予約を受け付けました</p>
          <p className="break-all text-xs text-hp-muted">bookingGroupId: {booked.bookingGroupId}</p>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-hp">候補日時</legend>
          <div className="grid gap-2">
            {topCandidates.map((candidate, index) => {
              const selected = selectedIndex === index
              return (
                <button
                  key={`${candidate.start}-${candidate.end}`}
                  type="button"
                  className={[
                    "glass-btn px-3 py-2 text-left text-sm",
                    selected ? "border-[var(--accent-primary)]" : "",
                  ].join(" ")}
                  aria-pressed={selected}
                  onClick={() => setSelectedIndex(index)}
                >
                  <span className="block font-semibold text-hp">{candidate.label}</span>
                  {candidate.note ? (
                    <span className="block text-xs font-normal text-hp-muted">{candidate.note}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-hp">
            案件名
            <input
              value={projectTitle}
              onChange={(event) => setProjectTitle(event.target.value)}
              className="glass-input mt-2 w-full px-4 py-3 text-sm"
              placeholder="作品名または案件名"
              required
            />
          </label>
          <label className="block text-sm font-medium text-hp">
            納期
            <input
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="glass-input mt-2 w-full px-4 py-3 text-sm"
              placeholder="2026-06-30"
            />
          </label>
          <label className="block text-sm font-medium text-hp">
            会社名
            <input
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              className="glass-input mt-2 w-full px-4 py-3 text-sm"
              placeholder="会社名"
            />
          </label>
          <label className="block text-sm font-medium text-hp">
            担当者氏名
            <input
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
              className="glass-input mt-2 w-full px-4 py-3 text-sm"
              placeholder="氏名"
              required
            />
          </label>
          <label className="block text-sm font-medium text-hp sm:col-span-2">
            電話番号（任意）
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="glass-input mt-2 w-full px-4 py-3 text-sm"
              placeholder="連絡可能な電話番号"
            />
          </label>
          <label className="block text-sm font-medium text-hp sm:col-span-2">
            補足メモ
            <textarea
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              className="glass-input mt-2 min-h-24 w-full px-4 py-3 text-sm"
              placeholder="事前に共有したい内容"
            />
          </label>
        </div>

        <label className="glass-inset flex items-start gap-3 p-3 text-sm text-hp">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
            className="mt-1"
          />
          <span>利用規約と予約内容に同意します。</span>
        </label>

        {errorMessage ? (
          <p className="text-sm text-red-500" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {loginRequired ? <ChatbotLoginCard callbackUrl="/booking" /> : null}

        <button type="submit" disabled={!canSubmit} className="glass-btn w-full px-4 py-3 text-sm font-medium disabled:opacity-50">
          {submitting ? "送信中..." : "予約内容を送信"}
        </button>
      </form>
    </section>
  )

  if (!showDemo) return body

  return (
    <DemoStage script={bookingOnboardingDemoScript} cursorLabel="予約デモ" active autoPlay>
      {body}
    </DemoStage>
  )
}
