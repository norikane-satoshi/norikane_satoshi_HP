"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { DemoStage } from "@/components/chatbot/demo"
import { ChatbotLoginCard } from "@/components/chatbot/widget/ChatbotLoginCard"
import { mapErrorCodeToJa } from "@/lib/booking/domain/api-schema"
import { bookingOnboardingDemoScript } from "@/lib/chatbot/demo"
import type { CandidateWindow, JobContext, WorkflowEstimate } from "@/lib/chatbot/domain/workflow-estimate"
import { isChatbotOperationError, postChatbotJson } from "./api"
import {
  CHATBOT_CONVERSATION_CONTENT_CLASS_NAME,
  CHATBOT_CONVERSATION_CONTENT_STYLE,
} from "./conversationTypography"

type BookingResult = {
  bookingGroupId: string
  bookingIds?: string[]
  scheduleLabel?: string
}

type ChatbotBookingCardProps = {
  conversationId?: string
  estimate?: WorkflowEstimate
  jobContext?: JobContext
  candidates: CandidateWindow[]
  busyDateKeys?: string[]
  defaultProjectTitle?: string
  defaultContactName?: string
  defaultContactEmail?: string
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
  bookingStatus?: string
  scheduleLabel?: string
  scheduleStatus?: string
}

type CandidatesApiResponse = {
  candidates?: CandidateWindow[]
  busyDateKeys?: string[]
}

const API_PATH = "/api/chatbot/create-booking-from-chat"
const CANDIDATES_API_PATH = "/api/chatbot/booking-candidates"
const MAX_VISIBLE_CANDIDATES = 31
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function estimateText(estimate?: WorkflowEstimate): string | null {
  if (!estimate) return null
  return `工程目安 ${estimate.totalMinDays}〜${estimate.totalMaxDays} 日`
}

function requiredDayCount(estimate?: WorkflowEstimate): number {
  return Math.max(1, Math.ceil(estimate?.totalMaxDays ?? estimate?.totalMinDays ?? 1))
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

function todayJstDateKey(): string {
  return jstDateKey(new Date())
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
  const day = Number(key.split("-")[2])
  return Number.isFinite(day) ? String(day) : key
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
  const leadingBlanks = getJstWeekday(monthStart)

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

function safeJstMonthKey(value: string | undefined): string | null {
  if (!value) return null
  const date = /^\d{4}-\d{2}$/.test(value)
    ? jstDateFromKey(`${value}-01`)
    : /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? jstDateFromKey(value)
      : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return jstMonthKey(date)
}

function resolveInitialMonthKey(input: {
  defaultDueDate: string
  jobContext?: JobContext
  firstCandidateStart?: string
}): string {
  return (
    safeJstMonthKey(input.defaultDueDate) ??
    safeJstMonthKey(input.jobContext?.publicReleaseDate) ??
    safeJstMonthKey(input.jobContext?.preferredStartDate) ??
    jstMonthKey(input.firstCandidateStart ?? new Date())
  )
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function RequiredMark() {
  return (
    <span className="ml-1 font-semibold text-red-500" aria-hidden="true">
      必須
    </span>
  )
}

export function ChatbotBookingCard({
  conversationId,
  estimate,
  jobContext,
  candidates,
  busyDateKeys = [],
  defaultProjectTitle = "",
  defaultContactName = "",
  defaultContactEmail = "",
  defaultCompanyName = "",
  defaultDueDate = "",
  defaultMemo = "",
  showDemo = false,
  onBooked,
  onRequireLogin,
}: ChatbotBookingCardProps) {
  const visibleCandidates = useMemo(() => candidates.slice(0, MAX_VISIBLE_CANDIDATES), [candidates])
  const initialMonthKey = useMemo(
    () => resolveInitialMonthKey({ defaultDueDate, jobContext, firstCandidateStart: visibleCandidates[0]?.start }),
    [defaultDueDate, jobContext, visibleCandidates],
  )
  const [displayedMonthOffset, setDisplayedMonthOffset] = useState(0)
  const effectiveEstimate = estimate ?? jobContext?.workflowEstimate
  const requiredDays = requiredDayCount(effectiveEstimate)
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
  const [contactEmail, setContactEmail] = useState(defaultContactEmail)
  const [phone, setPhone] = useState("")
  const [memo, setMemo] = useState(defaultMemo)
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loginRequired, setLoginRequired] = useState(false)
  const [booked, setBooked] = useState<BookingResult | null>(null)
  const projectTitleRef = useRef<HTMLTextAreaElement | null>(null)

  const currentJstDateKey = todayJstDateKey()
  const selectedKeys = useMemo(() => selectedDateKeys(selectedSlots), [selectedSlots])
  const trimmedContactEmail = contactEmail.trim()
  const contactEmailValid = isValidEmail(trimmedContactEmail)
  const contactEmailErrorVisible = trimmedContactEmail.length > 0 && !contactEmailValid
  const canSubmit = Boolean(
    projectTitle.trim() &&
      contactName.trim() &&
      contactEmailValid &&
      agreed &&
      !submitting,
  )

  useEffect(() => {
    if (!jobContext || !effectiveEstimate) return
    if (monthCandidateOverrides[displayedMonthKey]) return

    let cancelled = false

    fetch(CANDIDATES_API_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobContext,
        workflowEstimate: effectiveEstimate,
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
  }, [displayedMonthKey, displayedMonthOffset, effectiveEstimate, jobContext, monthCandidateOverrides, monthBusyDateKeyOverrides])

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
      const payload = await postChatbotJson<ApiResponse>(
        "create-booking-from-chat",
        API_PATH,
        {
          conversationId,
          projectTitle: projectTitle.trim(),
          contactName: contactName.trim(),
          contactEmail: trimmedContactEmail,
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
          workflowEstimate: effectiveEstimate,
        },
      )

      if (!payload.bookingGroupId) {
        setErrorMessage(mapErrorCodeToJa("unknown"))
        return
      }

      const result = {
        bookingGroupId: payload.bookingGroupId,
        bookingIds: payload.bookingIds,
        scheduleLabel: payload.scheduleLabel ?? (selectedSlots.length > 0 ? formatSelectedSlots(selectedSlots) : "候補日未選択"),
      }
      setBooked(result)
      onBooked?.(result)
    } catch (error) {
      if (isChatbotOperationError(error) && error.status === 401) {
        setLoginRequired(true)
        setErrorMessage("ログインして予約に進んでください")
        onRequireLogin?.()
        return
      }
      setErrorMessage(mapErrorCodeToJa(error instanceof Error ? error.message : "unknown"))
    } finally {
      setSubmitting(false)
    }
  }

  const body = (
    <section className="glass-card space-y-5 p-5" aria-label="チャット内予約">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-hp-muted">Booking</p>
        <h2 className="mt-1 text-base font-semibold text-hp">候補日時から予約する</h2>
        <p
          className={`${CHATBOT_CONVERSATION_CONTENT_CLASS_NAME} mt-2 text-sm text-hp-muted`}
          style={CHATBOT_CONVERSATION_CONTENT_STYLE}
        >
          素材搬入時期と納品希望日が決まっている場合は、候補を仮キープして予約内容を送信できます。
        </p>
        {estimateText(effectiveEstimate) ? (
          <p
            className={`${CHATBOT_CONVERSATION_CONTENT_CLASS_NAME} mt-2 text-xs font-medium text-hp-muted`}
            style={CHATBOT_CONVERSATION_CONTENT_STYLE}
          >
            {estimateText(effectiveEstimate)}
          </p>
        ) : null}
      </div>

      {booked ? (
        <div className="glass-inset space-y-2 p-4" role="status">
          <p className="text-sm font-semibold text-hp">予約を受け付けました</p>
          <p className="text-xs text-hp-muted">候補日: {booked.scheduleLabel ?? "候補日未選択"}</p>
          <p className="break-all text-xs text-hp-muted">予約番号: {booked.bookingGroupId}</p>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-hp">
            仮キープ候補
          </legend>
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
            <div className="mb-3 flex min-h-4 items-center justify-end gap-3">
              {monthLoadError ? (
                <p className="text-xs text-red-500" role="alert">{monthLoadError}</p>
              ) : null}
            </div>
            <div
              className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-hp-muted"
              aria-hidden="true"
              data-testid="chatbot-booking-weekday-header"
            >
              {["日", "月", "火", "水", "木", "金", "土"].map((day) => (
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
                const past = dateKey < currentJstDateKey

                if (busy) {
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      disabled
                      className={[
                        "relative min-h-11 cursor-default overflow-hidden rounded-[12px] border border-[var(--text-muted)] bg-[var(--text-muted)] px-1.5 py-2 text-xs text-white/95 opacity-85",
                        selected ? "ring-2 ring-[var(--accent-primary)] ring-offset-1 ring-offset-white/60" : "",
                      ].join(" ")}
                      data-calendar-state="busy"
                      data-selected={selected ? "true" : undefined}
                      aria-label={`${dateKey} 埋まり`}
                      aria-disabled="true"
                    >
                      <span className="block font-semibold">{formatCalendarDayLabel(dateKey)}</span>
                      <span className="pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-9 -translate-x-1/2 -translate-y-1/2 rotate-[-28deg] rounded-full bg-white/80" aria-hidden="true" />
                    </button>
                  )
                }

                if (past || !slot) {
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      disabled
                      className={[
                        "relative min-h-11 cursor-default rounded-[12px] border px-1.5 py-2 text-xs transition",
                        selected
                          ? "border-[var(--accent-primary)] bg-[var(--accent-primary)] font-bold text-white ring-2 ring-[var(--accent-primary)]/35 ring-inset"
                          : past
                            ? "border-white/45 bg-white/30 text-hp-muted opacity-45"
                            : "border-white/55 bg-white/35 text-hp-muted opacity-70",
                      ].join(" ")}
                      data-calendar-state={past ? "past" : "free-unstartable"}
                      data-selected={selected ? "true" : undefined}
                      aria-label={`${dateKey} 空き・開始不可`}
                      aria-disabled="true"
                    >
                      <span className="block font-semibold">{formatCalendarDayLabel(dateKey)}</span>
                    </button>
                  )
                }

                return (
                  <button
                    key={dateKey}
                    type="button"
                    className={[
                      "min-h-11 rounded-[12px] border px-1.5 py-2 text-xs transition duration-150 ease-out",
                      selected
                        ? "border-[var(--accent-primary)] bg-[var(--accent-primary)] font-bold text-white ring-2 ring-[var(--accent-primary)]/35 ring-inset shadow-[0_0_24px_rgba(117,104,214,0.24)]"
                        : "border-white/65 bg-white/55 text-hp hover:-translate-y-0.5 hover:scale-[1.04] hover:border-[var(--accent-primary)] hover:bg-white/85 hover:ring-2 hover:ring-[var(--accent-primary)]/45 hover:ring-inset hover:shadow-[0_0_24px_rgba(139,127,255,0.24)] focus-visible:border-[var(--accent-primary)] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/45 focus-visible:ring-inset",
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
                          setCalendarHint("上限")
                          return current
                        }
                        setCalendarHint(null)
                        return [...current, slot.candidate].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
                      })
                    }}
                  >
                    <span className="block font-semibold">{formatCalendarDayLabel(dateKey)}</span>
                  </button>
                )
              })}
            </div>
            {calendarHint ? (
              <p className="mt-3 text-xs leading-relaxed text-hp-muted" role="status" aria-live="polite">
                {calendarHint}
              </p>
            ) : null}
            <p className="mt-3 text-xs leading-relaxed text-hp-muted" aria-live="polite">
              <span className="font-semibold text-hp">
                {selectedSlots.length > 0 ? `${selectedSlots.length}／${requiredDays}` : "候補日未選択"}
              </span>
              {selectedSlots.length > 0 ? <span className="ml-2">{formatSelectedSlots(selectedSlots)}</span> : null}
            </p>
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-hp">
            案件名
            <RequiredMark />
            <textarea
              ref={projectTitleRef}
              value={projectTitle}
              onChange={(event) => setProjectTitle(event.target.value)}
              className="glass-input mt-2 min-h-12 w-full resize-none overflow-hidden px-4 py-3 text-sm leading-relaxed"
              placeholder="作品名または案件名（イニシャル表記も可）"
              aria-label="案件名"
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
              aria-label="納期"
            />
          </label>
          <label className="block text-sm font-medium text-hp">
            会社名
            <input
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              className="glass-input mt-2 w-full px-4 py-3 text-sm"
              placeholder="会社名"
              aria-label="会社名"
            />
          </label>
          <label className="block text-sm font-medium text-hp">
            担当者氏名
            <RequiredMark />
            <input
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
              className="glass-input mt-2 w-full px-4 py-3 text-sm"
              placeholder="氏名"
              aria-label="担当者氏名"
              required
            />
          </label>
          <label className="block text-sm font-medium text-hp sm:col-span-2">
            メールアドレス
            <RequiredMark />
            <input
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              className="glass-input mt-2 w-full px-4 py-3 text-sm"
              type="email"
              placeholder="client@example.jp"
              aria-invalid={contactEmailErrorVisible ? "true" : undefined}
              aria-label="メールアドレス"
              required
            />
          </label>
          {contactEmailErrorVisible ? (
            <p className="text-xs text-red-500 sm:col-span-2" role="alert">
              メールアドレスの形式を確認してください
            </p>
          ) : null}
          <label className="block text-sm font-medium text-hp sm:col-span-2">
            電話番号
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="glass-input mt-2 w-full px-4 py-3 text-sm"
              placeholder="連絡可能な電話番号"
              aria-label="電話番号"
            />
          </label>
          <label className="block text-sm font-medium text-hp sm:col-span-2">
            補足ノート
            <textarea
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              className="glass-input mt-2 min-h-24 w-full px-4 py-3 text-sm"
              placeholder="入力欄に入りきらない共有事項"
              aria-label="補足ノート"
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
          <span>
            <a
              href="/terms"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-4 hover:text-hp"
            >
              利用規約
            </a>
            、
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-4 hover:text-hp"
            >
              プライバシーポリシー
            </a>
            と予約内容に同意します。
            <RequiredMark />
          </span>
        </label>

        {errorMessage ? (
          <p className="text-sm text-red-500" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <button type="submit" disabled={!canSubmit} className="glass-btn w-full px-4 py-3 text-sm font-medium disabled:opacity-50">
          {submitting ? "送信中..." : "予約内容を送信"}
        </button>
      </form>

      {loginRequired ? <ChatbotLoginCard callbackUrl="/booking" /> : null}
    </section>
  )

  if (!showDemo) return body

  return (
    <DemoStage script={bookingOnboardingDemoScript} cursorLabel="予約デモ" active autoPlay>
      {body}
    </DemoStage>
  )
}
