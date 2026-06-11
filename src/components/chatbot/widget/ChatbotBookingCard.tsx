"use client"

import { FormEvent, useEffect, useMemo, useRef, useState } from "react"

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
const MAX_VISIBLE_CANDIDATES = 12

function parseApiResponse(value: unknown): ApiResponse {
  if (!value || typeof value !== "object") return {}
  return value as ApiResponse
}

function estimateText(estimate?: WorkflowEstimate): string | null {
  if (!estimate) return null
  return `工程目安 ${estimate.totalMinDays}〜${estimate.totalMaxDays} 日`
}

function formatCandidateDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(date)
}

function formatCandidateTimeRange(candidate: CandidateWindow): string {
  const start = new Date(candidate.start)
  const end = new Date(candidate.end)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return candidate.label
  if (isMultiDayCandidate(start, end)) return "連続日程"

  const formatter = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  })
  return `${formatter.format(start)}-${formatter.format(end)}`
}

function isMultiDayCandidate(start: Date, end: Date): boolean {
  return formatCandidateDate(start.toISOString()) !== formatCandidateDate(end.toISOString())
}

function buildCandidateSeatMap(candidates: CandidateWindow[]) {
  const dates = Array.from(new Set(candidates.map((candidate) => formatCandidateDate(candidate.start))))
  const timeRanges = Array.from(new Set(candidates.map(formatCandidateTimeRange)))
  const slotByCell = new Map<string, { candidate: CandidateWindow; index: number }>()

  candidates.forEach((candidate, index) => {
    slotByCell.set(`${formatCandidateDate(candidate.start)}|${formatCandidateTimeRange(candidate)}`, {
      candidate,
      index,
    })
  })

  return { dates, timeRanges, slotByCell }
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
  const visibleCandidates = useMemo(() => candidates.slice(0, MAX_VISIBLE_CANDIDATES), [candidates])
  const candidateSeatMap = useMemo(() => buildCandidateSeatMap(visibleCandidates), [visibleCandidates])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(visibleCandidates.length === 1 ? 0 : null)
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
  const projectTitleRef = useRef<HTMLTextAreaElement | null>(null)

  const selectedSlot = selectedIndex === null ? null : visibleCandidates[selectedIndex] ?? null
  const canSubmit = Boolean(selectedSlot && projectTitle.trim() && contactName.trim() && agreed && !submitting)

  useEffect(() => {
    const textarea = projectTitleRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  }, [projectTitle])

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
          素材搬入時期と納品希望日が決まっている場合は、候補を仮キープして予約内容を送信できます。
        </p>
        {estimateText(estimate) ? (
          <p className="mt-2 text-xs font-medium text-hp-muted">{estimateText(estimate)}</p>
        ) : null}
      </div>

      {booked ? (
        <div className="glass-inset space-y-2 p-4" role="status">
          <p className="text-sm font-semibold text-hp">予約を受け付けました</p>
          <p className="break-all text-xs text-hp-muted">予約番号: {booked.bookingGroupId}</p>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-hp">仮キープ候補</legend>
          <div className="overflow-x-auto rounded-[16px]" aria-label="仮キープ候補の座席選択">
            <div
              className="grid min-w-[520px] gap-2"
              style={{ gridTemplateColumns: `minmax(5.5rem,0.8fr) repeat(${Math.max(candidateSeatMap.dates.length, 1)}, minmax(8rem,1fr))` }}
            >
              <div className="text-xs font-medium text-hp-muted">枠</div>
              {candidateSeatMap.dates.map((date) => (
                <div key={date} className="text-center text-xs font-semibold text-hp">
                  {date}
                </div>
              ))}
              {candidateSeatMap.timeRanges.map((timeRange) => (
                <div key={timeRange} className="contents">
                  <div className="flex items-center text-xs font-medium text-hp-muted">{timeRange}</div>
                  {candidateSeatMap.dates.map((date) => {
                    const slot = candidateSeatMap.slotByCell.get(`${date}|${timeRange}`)
                    if (!slot) {
                      return (
                        <button
                          key={`${date}-${timeRange}-empty`}
                          type="button"
                          disabled
                          className="glass-btn min-h-16 px-3 py-2 text-center text-xs opacity-35"
                          aria-disabled="true"
                        >
                          空きなし
                        </button>
                      )
                    }

                    const selected = selectedIndex === slot.index
                    return (
                      <button
                        key={`${slot.candidate.start}-${slot.candidate.end}`}
                        type="button"
                        className={[
                          "glass-btn min-h-16 px-3 py-2 text-center text-sm",
                          selected ? "border-[var(--accent-primary)] bg-white/75 shadow-[0_0_24px_rgba(139,127,255,0.25)]" : "",
                        ].join(" ")}
                        aria-pressed={selected}
                        onClick={() => setSelectedIndex(slot.index)}
                      >
                        <span className="block font-semibold text-hp">{slot.candidate.label}</span>
                        {slot.candidate.note ? (
                          <span className="block text-xs font-normal text-hp-muted">{slot.candidate.note}</span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-hp">
            案件名（必須）
            <textarea
              ref={projectTitleRef}
              value={projectTitle}
              onChange={(event) => setProjectTitle(event.target.value)}
              className="glass-input mt-2 min-h-12 w-full resize-none overflow-hidden px-4 py-3 text-sm leading-relaxed"
              placeholder="作品名または案件名（イニシャル表記も可）"
              required
            />
          </label>
          <label className="block text-sm font-medium text-hp">
            納期（任意）
            <input
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="glass-input mt-2 w-full px-4 py-3 text-sm"
              placeholder="2026-06-30"
            />
          </label>
          <label className="block text-sm font-medium text-hp">
            会社名（任意）
            <input
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              className="glass-input mt-2 w-full px-4 py-3 text-sm"
              placeholder="会社名"
            />
          </label>
          <label className="block text-sm font-medium text-hp">
            担当者氏名（必須）
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
            補足ノート（任意）
            <textarea
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              className="glass-input mt-2 min-h-24 w-full px-4 py-3 text-sm"
              placeholder="入力欄に入りきらない共有事項"
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
          <span>利用規約と予約内容に同意します（必須）。</span>
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
