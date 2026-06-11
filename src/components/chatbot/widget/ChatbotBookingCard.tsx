"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { DemoStage } from "@/components/chatbot/demo"
import { ChatbotLoginCard } from "@/components/chatbot/widget/ChatbotLoginCard"
import { mapErrorCodeToJa } from "@/lib/booking/domain/api-schema"
import { bookingOnboardingDemoScript } from "@/lib/chatbot/demo"
import type { CandidateWindow, JobContext, WorkflowEstimate } from "@/lib/chatbot/domain/workflow-estimate"

type BookingResult = {
  bookingGroupId: string
  bookingIds?: string[]
}

type ChatbotBookingCardProps = {
  conversationId?: string
  estimate?: WorkflowEstimate
  jobContext?: JobContext
  candidates: CandidateWindow[]
  busyDateKeys?: string[]
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

type CandidatesApiResponse = {
  candidates?: CandidateWindow[]
  busyDateKeys?: string[]
}

const API_PATH = "/api/chatbot/create-booking-from-chat"
const CANDIDATES_API_PATH = "/api/chatbot/booking-candidates"
const MAX_VISIBLE_CANDIDATES = 31
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function parseApiResponse(value: unknown): ApiResponse {
  if (!value || typeof value !== "object") return {}
  return value as ApiResponse
}

function estimateText(estimate?: WorkflowEstimate): string | null {
  if (!estimate) return null
  return `工程目安 ${estimate.totalMinDays}〜${estimate.totalMaxDays} 日`
}

function requiredDayCount(estimate?: WorkflowEstimate): number {
  return Math.max(1, Math.ceil(estimate?.totalMinDays ?? 1))
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

function jstDateKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : ""
  const jst = new Date(date.getTime() + JST_OFFSET_MS)
  return [
    String(jst.getUTCFullYear()),
    String(jst.getUTCMonth() + 1).padStart(2, "0"),
    String(jst.getUTCDate()).padStart(2, "0"),
  ].join("-")
}

function jstDateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day) - JST_OFFSET_MS)
}

function addJstDays(date: Date, days: number): Date {
  const key = jstDateKey(date)
  const [year, month, day] = key.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days) - JST_OFFSET_MS)
}

function formatCalendarDayLabel(key: string): string {
  const date = jstDateFromKey(key)
  if (Number.isNaN(date.getTime())) return key
  return new Intl.DateTimeFormat("ja-JP", {
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(date)
}

function formatCalendarMonthLabel(key: string): string {
  const date = /^\d{4}-\d{2}$/.test(key) ? jstDateFromKey(`${key}-01`) : jstDateFromKey(key)
  if (Number.isNaN(date.getTime())) return "候補カレンダー"
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Tokyo",
  }).format(date)
}

function jstMonthKey(value: string | Date): string {
  return jstDateKey(value).slice(0, 7)
}

function addJstMonths(monthKey: string, months: number): string {
  const [year, month] = monthKey.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1 + months, 1) - JST_OFFSET_MS)
  return jstMonthKey(date)
}

function getJstWeekday(date: Date): number {
  return new Date(date.getTime() + JST_OFFSET_MS).getUTCDay()
}

function buildMonthCells(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number)
  const monthStart = new Date(Date.UTC(year, month - 1, 1) - JST_OFFSET_MS)
  const nextMonthStart = new Date(Date.UTC(year, month, 1) - JST_OFFSET_MS)
  const cells: Array<string | null> = []
  const leadingBlanks = (getJstWeekday(monthStart) + 6) % 7

  for (let i = 0; i < leadingBlanks; i += 1) {
    cells.push(null)
  }

  for (let cursor = monthStart; cursor.getTime() < nextMonthStart.getTime(); cursor = addJstDays(cursor, 1)) {
    cells.push(jstDateKey(cursor))
  }

  while (cells.length % 7 !== 0) {
    cells.push(null)
  }

  return cells
}

function buildCandidateCalendar(monthKey: string, candidates: CandidateWindow[], busyDateKeys: string[]) {
  const candidateByStartDate = new Map<string, { candidate: CandidateWindow; index: number }>()
  const busyDateKeySet = new Set(busyDateKeys.filter((key) => key.startsWith(`${monthKey}-`)))

  candidates.forEach((candidate, index) => {
    if (candidate.available === false) return
    candidateByStartDate.set(jstDateKey(candidate.start), { candidate, index })
  })

  return {
    monthLabel: formatCalendarMonthLabel(monthKey),
    dayCells: buildMonthCells(monthKey),
    candidateByStartDate,
    busyDateKeySet,
  }
}

function selectedDateKeys(slots: CandidateWindow[]) {
  return new Set(slots.map((slot) => jstDateKey(slot.start)))
}

function formatSelectedSlots(slots: CandidateWindow[]): string {
  return slots.map((slot) => formatCandidateDate(slot.start)).join("、")
}

export function ChatbotBookingCard({
  conversationId,
  estimate,
  jobContext,
  candidates,
  busyDateKeys = [],
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
  const initialMonthKey = useMemo(
    () => jstMonthKey(visibleCandidates[0]?.start ?? new Date()),
    [visibleCandidates],
  )
  const [displayedMonthOffset, setDisplayedMonthOffset] = useState(0)
  const requiredDays = requiredDayCount(estimate)
  const displayedMonthKey = useMemo(
    () => addJstMonths(initialMonthKey, displayedMonthOffset),
    [displayedMonthOffset, initialMonthKey],
  )
  const [monthCandidateOverrides, setMonthCandidateOverrides] = useState<Record<string, CandidateWindow[]>>({})
  const [monthBusyDateKeyOverrides, setMonthBusyDateKeyOverrides] = useState<Record<string, string[]>>({})
  const displayedCandidates = useMemo(
    () => monthCandidateOverrides[displayedMonthKey] ?? visibleCandidates.filter((candidate) => jstMonthKey(candidate.start) === displayedMonthKey),
    [displayedMonthKey, monthCandidateOverrides, visibleCandidates],
  )
  const displayedBusyDateKeys = useMemo(
    () => monthBusyDateKeyOverrides[displayedMonthKey] ?? busyDateKeys.filter((key) => key.startsWith(`${displayedMonthKey}-`)),
    [busyDateKeys, displayedMonthKey, monthBusyDateKeyOverrides],
  )
  const candidateCalendar = useMemo(
    () => buildCandidateCalendar(displayedMonthKey, displayedCandidates, displayedBusyDateKeys),
    [displayedBusyDateKeys, displayedCandidates, displayedMonthKey],
  )
  const [selectedSlots, setSelectedSlots] = useState<CandidateWindow[]>(() => (
    visibleCandidates.length === 1 && requiredDays === 1 ? [visibleCandidates[0]] : []
  ))
  const [monthLoadError, setMonthLoadError] = useState<string | null>(null)
  const [calendarHint, setCalendarHint] = useState<string | null>(null)
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

  const selectedKeys = useMemo(() => selectedDateKeys(selectedSlots), [selectedSlots])
  const canSubmit = Boolean(selectedSlots.length === requiredDays && projectTitle.trim() && contactName.trim() && agreed && !submitting)

  useEffect(() => {
    if (displayedMonthOffset === 0) return
    if (!jobContext || !estimate) return
    if (monthCandidateOverrides[displayedMonthKey]) return

    let cancelled = false

    fetch(CANDIDATES_API_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobContext,
        workflowEstimate: estimate,
        month: displayedMonthKey,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("booking_candidates_failed")
        return (await response.json()) as CandidatesApiResponse
      })
      .then((payload) => {
        if (cancelled) return
        setMonthCandidateOverrides((current) => ({
          ...current,
          [displayedMonthKey]: Array.isArray(payload.candidates) ? payload.candidates.slice(0, MAX_VISIBLE_CANDIDATES) : [],
        }))
        setMonthBusyDateKeyOverrides((current) => ({
          ...current,
          [displayedMonthKey]: Array.isArray(payload.busyDateKeys) ? payload.busyDateKeys : [],
        }))
        setMonthLoadError(null)
      })
      .catch(() => {
        if (!cancelled) setMonthLoadError("候補の読み込みに失敗しました")
      })

    return () => {
      cancelled = true
    }
  }, [displayedMonthKey, displayedMonthOffset, estimate, jobContext, monthCandidateOverrides, monthBusyDateKeyOverrides])

  useEffect(() => {
    const textarea = projectTitleRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  }, [projectTitle])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return

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
          selectedSlots: selectedSlots.map((slot) => ({
            start: slot.start,
            end: slot.end,
          })),
          jobContext,
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
          <div className="rounded-[16px] border border-white/55 bg-white/35 p-3" aria-label="仮キープ候補のカレンダー選択">
            <div className="mb-3 flex items-center justify-between gap-3">
              <button
                type="button"
                className="glass-btn flex h-9 w-9 items-center justify-center disabled:opacity-35"
                aria-label="前月を表示"
                disabled={displayedMonthOffset <= -1}
                onClick={() => setDisplayedMonthOffset((value) => Math.max(-1, value - 1))}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <p className="text-sm font-semibold text-hp" aria-live="polite">{candidateCalendar.monthLabel}</p>
              <button
                type="button"
                className="glass-btn flex h-9 w-9 items-center justify-center disabled:opacity-35"
                aria-label="翌月を表示"
                disabled={displayedMonthOffset >= 1}
                onClick={() => setDisplayedMonthOffset((value) => Math.min(1, value + 1))}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs text-hp-muted">空き日と開始可否を分けて表示しています</p>
              {monthLoadError ? (
                <p className="text-xs text-red-500" role="alert">{monthLoadError}</p>
              ) : null}
            </div>
            <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-hp-muted" aria-hidden="true">
              {["月", "火", "水", "木", "金", "土", "日"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="mt-1.5 grid grid-cols-7 gap-1.5" data-testid="chatbot-booking-month-grid">
              {candidateCalendar.dayCells.map((dateKey, cellIndex) => {
                if (!dateKey) {
                  return <span key={`blank-${cellIndex}`} aria-hidden="true" />
                }

                const slot = candidateCalendar.candidateByStartDate.get(dateKey)
                const busy = candidateCalendar.busyDateKeySet.has(dateKey)
                const selected = selectedKeys.has(dateKey)

                if (busy) {
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      disabled
                      className={[
                        "min-h-11 rounded-[12px] border border-[var(--text-muted)] bg-[var(--text-muted)] px-1.5 py-2 text-xs text-white/95 opacity-85",
                        selected ? "ring-2 ring-[var(--accent-primary)] ring-offset-1 ring-offset-white/60" : "",
                      ].join(" ")}
                      data-calendar-state="busy"
                      data-selected={selected ? "true" : undefined}
                      aria-label={`${dateKey} 埋まり`}
                      aria-disabled="true"
                    >
                      <span className="block font-semibold">{formatCalendarDayLabel(dateKey)}</span>
                      <span className="block text-[10px] text-white/85">埋まり</span>
                    </button>
                  )
                }

                if (!slot) {
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      className={[
                        "min-h-11 rounded-[12px] border px-1.5 py-2 text-xs transition",
                        selected
                          ? "border-[var(--accent-primary)] bg-white/65 text-hp"
                          : "border-white/55 bg-white/40 text-hp-muted hover:bg-white/55",
                      ].join(" ")}
                      data-calendar-state="free-unstartable"
                      data-selected={selected ? "true" : undefined}
                      aria-label={`${dateKey} 空き・開始不可`}
                      aria-disabled="true"
                      onClick={() => setCalendarHint("この日は搬入前・リードタイム内・営業外のため選択できません")}
                    >
                      <span className="block font-semibold">{formatCalendarDayLabel(dateKey)}</span>
                      <span className="block text-[10px] text-hp-muted">開始不可</span>
                    </button>
                  )
                }

                return (
                  <button
                    key={dateKey}
                    type="button"
                    className={[
                      "min-h-11 rounded-[12px] border px-1.5 py-2 text-xs transition",
                      selected
                        ? "border-[var(--accent-primary)] bg-white/80 text-hp shadow-[0_0_24px_rgba(117,104,214,0.22)]"
                        : "border-white/65 bg-white/55 text-hp hover:bg-white/75",
                    ].join(" ")}
                    data-selected={selected ? "true" : undefined}
                    data-calendar-state="startable"
                    aria-label={`${dateKey} 選択可`}
                    aria-pressed={selected}
                    onClick={() => {
                      setSelectedSlots((current) => {
                        const exists = current.some((selectedSlot) => jstDateKey(selectedSlot.start) === dateKey)
                        if (exists) {
                          setCalendarHint(null)
                          return current.filter((selectedSlot) => jstDateKey(selectedSlot.start) !== dateKey)
                        }
                        if (current.length >= requiredDays) {
                          setCalendarHint(`必要日数 ${requiredDays}日はすでに選択済みです`)
                          return current
                        }
                        setCalendarHint(null)
                        return [...current, slot.candidate].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
                      })
                    }}
                  >
                    <span className="block font-semibold">{formatCalendarDayLabel(dateKey)}</span>
                    <span className="block text-[10px] text-hp-muted">選択可</span>
                  </button>
                )
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-hp-muted" aria-label="仮キープ候補カレンダーの凡例">
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full border border-white/65 bg-white/55" aria-hidden="true" />
                選択可
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full border border-white/55 bg-white/40" aria-hidden="true" />
                空き・開始不可
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--text-muted)]" aria-hidden="true" />
                埋まり
              </span>
            </div>
            {calendarHint ? (
              <p className="mt-3 text-xs leading-relaxed text-hp-muted" role="status" aria-live="polite">
                {calendarHint}
              </p>
            ) : null}
            <p className="mt-3 text-xs leading-relaxed text-hp-muted" aria-live="polite">
              {selectedSlots.length}／{requiredDays}日選択中{selectedSlots.length > 0 ? `: ${formatSelectedSlots(selectedSlots)}` : ""}
            </p>
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
