"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"

import { AdminReconnectBanner } from "@/components/booking/admin-reconnect-banner"
import { BookingCalendar } from "@/components/booking/booking-calendar"
import { BookingConfirm } from "@/components/booking/booking-confirm"
import { BookingDone } from "@/components/booking/booking-done"
import { BookingFooter } from "@/components/booking/booking-footer"
import { BookingForm } from "@/components/booking/booking-form"
import { BookingProgressBar } from "@/components/booking/booking-progress-bar"
import { mapErrorCodeToJa } from "@/lib/booking/domain/api-schema"
import type { CalendarBookingFromApi } from "@/lib/booking/server/calendar-free-busy/bookings-repository"
import type { CalendarBusyEventWithBuffer } from "@/lib/google-calendar/server"
import { clearDraft, hasDraft, loadDraft, saveDraft } from "@/lib/booking/client/draft-storage"
import {
  createDefaultBookingFormData,
  type BookingFormData,
  type BookingSlot,
  type BookingStep,
} from "@/lib/booking/domain/form-schema"

type BookingSectionProps = {
  userId: string
  userEmail: string
  isCalendarAdmin?: boolean
  initialBusy?: CalendarBusyEventWithBuffer[]
  initialBookings?: CalendarBookingFromApi[]
  initialRange?: { start: string; end: string }
  monthSkeleton?: ReactNode
}

type TeamOption = {
  id: string
  name: string
  members: { userId: string; name: string | null; email: string | null }[]
}

const steps: BookingStep[] = ["calendar", "form", "confirm", "done"]
const FORCE_REFRESH_AFTER_SUBMIT_KEY = "booking:force-refresh-after-submit"

function getStepFromUrl(): BookingStep {
  if (typeof window === "undefined") return "calendar"

  const value = new URLSearchParams(window.location.search).get("step")
  return steps.includes(value as BookingStep) ? (value as BookingStep) : "calendar"
}

function getNextStep(step: BookingStep): BookingStep {
  if (step === "calendar") return "form"
  if (step === "form") return "confirm"
  if (step === "confirm") return "done"
  return "done"
}

function getPreviousStep(step: BookingStep): BookingStep {
  if (step === "done") return "confirm"
  if (step === "confirm") return "form"
  if (step === "form") return "calendar"
  return "calendar"
}

function hasDraftContent(formData: BookingFormData, selectedSlots: BookingSlot[], step: BookingStep): boolean {
  return (
    step !== "calendar" ||
    selectedSlots.length > 0 ||
    formData.projectTitle.trim() !== "" ||
    formData.contactName.trim() !== "" ||
    formData.memo.trim() !== ""
  )
}

function pushStep(step: BookingStep): void {
  const url = new URL(window.location.href)
  url.search = `?step=${step}`
  window.history.pushState({ step }, "", url.toString())
}

function getInitialRemoteRefreshRequestKey(): number {
  if (typeof window === "undefined") return 0
  if (window.sessionStorage.getItem(FORCE_REFRESH_AFTER_SUBMIT_KEY) !== "1") return 0
  window.sessionStorage.removeItem(FORCE_REFRESH_AFTER_SUBMIT_KEY)
  return Date.now()
}

export function BookingSection({
  userId,
  userEmail,
  isCalendarAdmin = false,
  initialBusy = [],
  initialBookings = [],
  initialRange,
  monthSkeleton,
}: BookingSectionProps) {
  const defaultFormData = useMemo(() => createDefaultBookingFormData(userEmail), [userEmail])
  const [step, setStep] = useState<BookingStep>("calendar")
  const [formData, setFormData] = useState<BookingFormData>(defaultFormData)
  const [selectedSlots, setSelectedSlots] = useState<BookingSlot[]>([])
  const [formValid, setFormValid] = useState(false)
  const [localDraftAvailable, setLocalDraftAvailable] = useState(false)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [adjustRequestKey, setAdjustRequestKey] = useState(0)
  const [calendarResetRequestKey, setCalendarResetRequestKey] = useState(0)
  const [focusSlot, setFocusSlot] = useState<BookingSlot | null>(null)
  const [teams, setTeams] = useState<TeamOption[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [remoteRefreshRequestKey, setRemoteRefreshRequestKey] = useState(getInitialRemoteRefreshRequestKey)
  const [calendarCode, setCalendarCode] = useState<string | null>(null)
  const teamMemberUserIds = useMemo(() => {
    return teams.find((team) => team.id === selectedTeamId)?.members.map((member) => member.userId) ?? [userId]
  }, [selectedTeamId, teams, userId])

  useEffect(() => {
    let cancelled = false
    async function loadTeams() {
      try {
        const response = await fetch("/api/teams", { cache: "no-store" })
        if (!response.ok) return
        const payload = (await response.json()) as { teams?: TeamOption[] }
        if (!cancelled) setTeams(payload.teams ?? [])
      } catch {
        if (!cancelled) setTeams([])
      }
    }

    void loadTeams()
    return () => {
      cancelled = true
    }
  }, [])

  const applyDraft = useCallback(
    (draft: ReturnType<typeof loadDraft>, restoreStep = false, restoreSlots = true) => {
      if (!draft) return
      setFormData({
        ...defaultFormData,
        ...draft.formData,
        sessionEmail: userEmail,
      })
      if (restoreSlots) setSelectedSlots(draft.selectedSlots)
      if (restoreStep && draft.step !== "done") setStep(draft.step)
    },
    [defaultFormData, userEmail],
  )

  useEffect(() => {
    const initialStep = getStepFromUrl()
    // Initial state comes from URL/local storage after client hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep(initialStep)

    const sessionDraft = loadDraft(userId, "session")
    if (sessionDraft) applyDraft(sessionDraft, false, initialStep === "form" || initialStep === "confirm")
    setLocalDraftAvailable(!sessionDraft && hasDraft(userId))
    setDraftHydrated(true)

    const handlePopState = () => setStep(getStepFromUrl())
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [applyDraft, userId])

  useEffect(() => {
    if (!draftHydrated) return

    if (step === "done") {
      clearDraft(userId)
      // Local draft availability mirrors storage after completion clears the draft.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocalDraftAvailable(false)
      return
    }

    if (!hasDraftContent(formData, selectedSlots, step)) return

    const timeout = window.setTimeout(() => {
      saveDraft(userId, { formData, selectedSlots, step })
    }, 500)

    return () => window.clearTimeout(timeout)
  }, [draftHydrated, formData, selectedSlots, step, userId])

  const goToStep = useCallback((nextStep: BookingStep) => {
    setSubmitError(null)
    setStep(nextStep)
    pushStep(nextStep)
  }, [])

  const handleContinueDraft = () => {
    applyDraft(loadDraft(userId, "local"), true)
    setLocalDraftAvailable(false)
  }

  const handleDiscardDraft = () => {
    clearDraft(userId)
    setFormData(defaultFormData)
    setSelectedSlots([])
    setFocusSlot(null)
    setLocalDraftAvailable(false)
    setCalendarResetRequestKey((value) => value + 1)
    goToStep("calendar")
  }

  const handleCommitSlot = useCallback(
    (slots: { start: string; end: string }[]) => {
      setSubmitError(null)
      setSelectedSlots(slots.map((slot) => ({ start: slot.start, end: slot.end })))
      goToStep("form")
    },
    [goToStep],
  )

  const handleReselectDate = useCallback((slot?: BookingSlot) => {
    setFocusSlot(slot ?? null)
    setAdjustRequestKey((value) => value + 1)
    goToStep("calendar")
  }, [goToStep])

  const handleReset = () => {
    clearDraft(userId)
    setFormData(defaultFormData)
    setSelectedSlots([])
    setFocusSlot(null)
    setFormValid(false)
    setSubmitError(null)
    setCalendarResetRequestKey((value) => value + 1)
    goToStep("calendar")
  }

  const handleSubmitBooking = async () => {
    if (selectedSlots.length === 0 || submitting) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const response = await fetch("/api/booking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...formData,
          teamId: selectedTeamId,
          selectedSlots,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }

      if (response.ok) {
        clearDraft(userId)
        window.sessionStorage.setItem(FORCE_REFRESH_AFTER_SUBMIT_KEY, "1")
        setLocalDraftAvailable(false)
        setRemoteRefreshRequestKey((value) => value + 1)
        goToStep("done")
        return
      }

      setSubmitError(mapErrorCodeToJa(payload.error))
    } catch {
      setSubmitError(mapErrorCodeToJa("unknown"))
    } finally {
      setSubmitting(false)
    }
  }

  const canGoNext = (step === "form" && selectedSlots.length > 0 && formValid) || step === "confirm"

  const body = (
    <>
      <div className={step === "calendar" ? "booking-section__pane" : "booking-section__pane booking-section__pane--hidden"}>
        <BookingCalendar
          viewerUserId={userId}
          viewerEmail={userEmail}
          isCalendarAdmin={isCalendarAdmin}
          teamMemberUserIds={teamMemberUserIds}
          initialSlots={selectedSlots}
          projectTitle={formData.projectTitle}
          adjustRequestKey={adjustRequestKey}
          resetRequestKey={calendarResetRequestKey}
          focusSlot={focusSlot}
          teams={teams}
          selectedTeamId={selectedTeamId}
          onSelectedTeamIdChange={setSelectedTeamId}
          initialBusy={initialBusy}
          initialBookings={initialBookings}
          initialRange={initialRange}
          monthSkeleton={monthSkeleton}
          remoteRefreshRequestKey={remoteRefreshRequestKey}
          onCommit={handleCommitSlot}
          onCodeChange={setCalendarCode}
        />
      </div>
      <div className={step === "form" ? "booking-section__pane" : "booking-section__pane booking-section__pane--hidden"}>
        <BookingForm
          formData={formData}
          selectedSlots={selectedSlots}
          onChange={setFormData}
          onValidityChange={setFormValid}
          onReselectDate={handleReselectDate}
        />
      </div>
      <div className={step === "confirm" ? "booking-section__pane" : "booking-section__pane booking-section__pane--hidden"}>
        <BookingConfirm
          formData={formData}
          selectedSlots={selectedSlots}
          submitError={submitError}
          onDismissSubmitError={() => setSubmitError(null)}
          onReselectDate={handleReselectDate}
        />
      </div>
      <div className={step === "done" ? "booking-section__pane" : "booking-section__pane booking-section__pane--hidden"}>
        <BookingDone selectedSlots={selectedSlots} />
      </div>
    </>
  )

  return (
    <div className="booking-section">
      <AdminReconnectBanner isCalendarAdmin={isCalendarAdmin} code={calendarCode} />
      <BookingProgressBar currentStep={step} />
      {localDraftAvailable && step !== "done" ? (
        <div className="booking-section__draft-banner glass-inset">
          <span>入力途中の予約申込があります（24 時間以内）</span>
          <div className="booking-section__draft-actions">
            <button className="booking-section__text-button" type="button" onClick={handleContinueDraft}>
              続きから入力する
            </button>
            <button className="booking-section__text-button" type="button" onClick={handleDiscardDraft}>
              破棄する
            </button>
          </div>
        </div>
      ) : null}
      <div className="booking-section__body">{body}</div>
      <BookingFooter
        step={step}
        canGoNext={canGoNext}
        submitting={step === "confirm" && submitting}
        onBack={() => goToStep(getPreviousStep(step))}
        onNext={() => {
          if (step === "confirm") {
            void handleSubmitBooking()
            return
          }
          goToStep(getNextStep(step))
        }}
        onReset={handleReset}
      />
    </div>
  )
}
