"use client"

import FullCalendar from "@fullcalendar/react"
import dayGridPlugin from "@fullcalendar/daygrid"
import interactionPlugin, {
  type DateClickArg,
  type EventDragStartArg,
  type EventDragStopArg,
  type EventResizeDoneArg,
  type EventResizeStartArg,
  type EventResizeStopArg,
} from "@fullcalendar/interaction"
import timeGridPlugin from "@fullcalendar/timegrid"
import jaLocale from "@fullcalendar/core/locales/ja"
import type {
  AllowFunc,
  DateSelectArg,
  DayCellContentArg,
  DayCellMountArg,
  EventContentArg,
  EventClickArg,
  EventDropArg,
  EventApi,
  EventInput,
  EventMountArg,
  EventSourceFuncArg,
} from "@fullcalendar/core"
import { format } from "date-fns"
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"

import { mapErrorCodeToJa, type BookingConflictsResponse } from "@/lib/booking/api-schema"
import { getHolidayName } from "@/lib/booking/holidays"
import type { BookingSlot } from "@/lib/booking/form-schema"

type CalendarView = "dayGridMonth" | "timeGridWeek" | "timeGridDay"

type BusySlot = {
  start: string
  end: string
}

type BookingFromApi = {
  id: string
  bookingGroupId: string
  start: string
  end: string
  title: string
  status: BookingStatus | string
}

type FreeBusyResponse = {
  busy?: BusySlot[]
  bookings?: BookingFromApi[]
  code?: string
}

type BookingKind = "confirmed" | "tentative"
type BookingStatus = "CONFIRMED" | "TENTATIVE" | "PENDING_CONFIRMATION"

type BusyEventProps = {
  kind: "busy"
  label: string
  status?: BookingStatus
  bookingId?: string
  bookingGroupId?: string
  projectTitle?: string
}

type DraftEventProps = {
  kind: "draft"
  draftId: string
  sourceKind?: BookingKind
}

type AnyEventProps = {
  kind?: "draft" | "busy"
  label?: string
  status?: BookingStatus
  bookingId?: string
  bookingGroupId?: string
  projectTitle?: string
  draftId?: string
  sourceKind?: BookingKind
}

type DraftEvent = {
  id: string
  start: string
  end: string
  sourceKind?: BookingKind
}

type ModeKind = "normal" | "adjust"

type MoveCopyPopupState = {
  bookingId: string
  start: string
  end: string
  x: number
  y: number
} | null

type InteractionType = "drag" | "resize" | "select" | null

const VIEW_OPTIONS: { label: string; value: CalendarView }[] = [
  { label: "月", value: "dayGridMonth" },
  { label: "週", value: "timeGridWeek" },
  { label: "日", value: "timeGridDay" },
]

const MIN_SELECTION_MS = 30 * 60 * 1000
const BASE_SLOT_MIN_MINUTES = 10 * 60
const BASE_SLOT_MAX_MINUTES = 19 * 60
const TIME_RANGE_EXPAND_STEP_MINUTES = 30
const TIME_RANGE_EXPAND_THROTTLE_MS = 200

function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function hasTimePart(value: string): boolean {
  return /T\d{2}:\d{2}/.test(value)
}

function isFullDayBusySlot(slot: BusySlot): boolean {
  if (!hasTimePart(slot.start) || !hasTimePart(slot.end)) return true

  const start = new Date(slot.start)
  const end = new Date(slot.end)
  const startsAtMidnight = start.getHours() === 0 && start.getMinutes() === 0
  const endsAtMidnight = end.getHours() === 0 && end.getMinutes() === 0
  const durationMs = end.getTime() - start.getTime()

  return startsAtMidnight && endsAtMidnight && durationMs >= 24 * 60 * 60 * 1000
}

function getBusyLabel(slot: BusySlot): string {
  if (isFullDayBusySlot(slot)) return "終日"

  return `${format(new Date(slot.start), "HH:mm")}-${format(new Date(slot.end), "HH:mm")}`
}

function toBusyEvent(slot: BusySlot): EventInput {
  const allDay = isFullDayBusySlot(slot)
  const label = getBusyLabel(slot)
  const extendedProps: BusyEventProps = {
    kind: "busy",
    label,
  }

  return {
    id: `busy-${slot.start}-${slot.end}`,
    title: "予約不可",
    start: slot.start,
    end: slot.end,
    allDay,
    display: "block",
    classNames: ["booking-calendar__busy"],
    editable: false,
    startEditable: false,
    durationEditable: false,
    extendedProps,
  }
}

function toBookingEvent(
  booking: BookingFromApi,
  editable: boolean,
): EventInput {
  const label = `${format(new Date(booking.start), "HH:mm")}-${format(new Date(booking.end), "HH:mm")}`
  const status = (booking.status as BusyEventProps["status"]) ?? "CONFIRMED"
  const isConfirmed = status === "CONFIRMED"
  const isTentative = isTentativeStatus(status)
  const canEdit = editable && !isConfirmed
  const extendedProps: BusyEventProps = {
    kind: "busy",
    label,
    status,
    bookingId: booking.id,
    bookingGroupId: booking.bookingGroupId,
    projectTitle: booking.title,
  }
  return {
    id: `booking-${booking.id}`,
    title: label,
    start: booking.start,
    end: booking.end,
    allDay: false,
    display: "block",
    classNames: [
      "booking-calendar__booking-event",
      isTentative ? "booking-calendar__booking-event--tentative" : "booking-calendar__booking-event--confirmed",
    ],
    editable: canEdit,
    startEditable: canEdit,
    durationEditable: canEdit,
    extendedProps,
  }
}

function toDraftEventInput(
  draft: DraftEvent,
  isActive: boolean,
): EventInput {
  const extendedProps: DraftEventProps = {
    kind: "draft",
    draftId: draft.id,
    sourceKind: draft.sourceKind,
  }
  const classes = ["booking-calendar__draft"]
  if (isActive) classes.push("booking-calendar__draft--active")
  return {
    id: draft.id,
    title: "",
    start: draft.start,
    end: draft.end,
    allDay: false,
    classNames: classes,
    editable: true,
    startEditable: true,
    durationEditable: true,
    extendedProps,
  }
}

async function fetchFreeBusy(arg: EventSourceFuncArg): Promise<FreeBusyResponse> {
  const params = new URLSearchParams({
    start: arg.startStr,
    end: arg.endStr,
  })
  const response = await fetch(`/api/calendar/free-busy?${params.toString()}`, {
    cache: "no-store",
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 503) {
      return (await response.json().catch(() => ({ busy: [], bookings: [] }))) as FreeBusyResponse
    }
    throw new Error(`free-busy request failed: ${response.status}`)
  }

  return (await response.json()) as FreeBusyResponse
}

function makeDraftId(): string {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatRange(start: string, end: string): string {
  const startDate = new Date(start)
  const endDate = new Date(end)
  return `${startDate.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })} - ${endDate.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  })}`
}

function isSelectableView(viewType: string): boolean {
  return viewType === "timeGridWeek"
}

function hasMinimumSelectionDuration(start: Date, end: Date): boolean {
  return end.getTime() - start.getTime() >= MIN_SELECTION_MS
}

function isTentativeStatus(status: BookingStatus | string | undefined): boolean {
  return status === "TENTATIVE" || status === "PENDING_CONFIRMATION"
}

function rangesOverlap(start: Date, end: Date, otherStart: string, otherEnd: string): boolean {
  return start.getTime() < new Date(otherEnd).getTime() && end.getTime() > new Date(otherStart).getTime()
}

function parseTimeMinutes(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":")
  return Number(hours) * 60 + Number(minutes)
}

function formatTimeMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, minutes))
  const hours = Math.floor(clamped / 60)
  const restMinutes = clamped % 60
  return `${String(hours).padStart(2, "0")}:${String(restMinutes).padStart(2, "0")}:00`
}

function timeOfDayMinutes(value: string): number | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.getHours() * 60 + date.getMinutes()
}

function recomputeTimeRangeBounds(slots: { start: string; end: string }[]): { slotMinTime: string; slotMaxTime: string } {
  let minMinutes = BASE_SLOT_MIN_MINUTES
  let maxMinutes = BASE_SLOT_MAX_MINUTES

  for (const slot of slots) {
    const startMinutes = timeOfDayMinutes(slot.start)
    const endMinutes = timeOfDayMinutes(slot.end)
    if (startMinutes !== null) minMinutes = Math.min(minMinutes, startMinutes)
    if (endMinutes !== null) maxMinutes = Math.max(maxMinutes, endMinutes)
  }

  return {
    slotMinTime: formatTimeMinutes(Math.max(0, minMinutes)),
    slotMaxTime: formatTimeMinutes(Math.min(24 * 60, maxMinutes)),
  }
}

type BookingCalendarProps = {
  initialSlots?: { start: string; end: string }[]
  projectTitle?: string
  adjustRequestKey?: number
  resetRequestKey?: number
  focusSlot?: BookingSlot | null
  onCommit: (slots: { start: string; end: string }[], kind: BookingKind) => void
}

export function BookingCalendar({
  initialSlots = [],
  projectTitle,
  adjustRequestKey = 0,
  resetRequestKey = 0,
  focusSlot = null,
  onCommit,
}: BookingCalendarProps) {
  const [view, setView] = useState<CalendarView>("dayGridMonth")
  const [modeKind, setModeKind] = useState<ModeKind>("normal")
  const [adjustingGroupId, setAdjustingGroupId] = useState<string | null>(null)
  const [adjustingTitle, setAdjustingTitle] = useState<string | null>(null)
  const [slotMinTime, setSlotMinTime] = useState("10:00:00")
  const [slotMaxTime, setSlotMaxTime] = useState("19:00:00")
  const [moveCopyPopup, setMoveCopyPopup] = useState<MoveCopyPopupState>(null)
  const [actionPanelPosition, setActionPanelPosition] = useState<{ top: number; left: number } | null>(null)
  const calendarRef = useRef<FullCalendar | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const actionPanelRef = useRef<HTMLDivElement | null>(null)
  const selectedViewRef = useRef<CalendarView>("dayGridMonth")
  const interactionInProgressRef = useRef(false)
  const interactionTypeRef = useRef<InteractionType>(null)
  const lastTopExpandAtRef = useRef<number | null>(null)
  const lastBottomExpandAtRef = useRef<number | null>(null)
  const draftPreviewRef = useRef<DraftEvent | null>(null)
  const fetchedRef = useRef<Map<string, FreeBusyResponse>>(new Map())

  const initialDrafts = useMemo<DraftEvent[]>(() => {
    return initialSlots.map((slot) => ({ id: makeDraftId(), start: slot.start, end: slot.end }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [drafts, setDrafts] = useState<DraftEvent[]>(initialDrafts)
  const [activeDraftId, setActiveDraftId] = useState<string | null>(initialDrafts[0]?.id ?? null)
  const [draftPreview, setDraftPreview] = useState<DraftEvent | null>(null)

  const [warningModal, setWarningModal] = useState<
    { kind: BookingKind; message: string; slot: { start: string; end: string } } | null
  >(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [preflighting, setPreflighting] = useState(false)
  const initialSlotsSignature = useMemo(
    () => initialSlots.map((slot) => `${slot.start}|${slot.end}`).join("||"),
    [initialSlots],
  )
  const restoredInitialSlotsSignatureRef = useRef(initialSlotsSignature)

  const activeDraft = useMemo(
    () => drafts.find((draft) => draft.id === activeDraftId) ?? null,
    [drafts, activeDraftId],
  )
  const activePanelDraft = draftPreview?.id === activeDraftId ? draftPreview : activeDraft

  const setDraftPreviewValue = useCallback((preview: DraftEvent | null) => {
    draftPreviewRef.current = preview
    setDraftPreview(preview)
  }, [])

  useEffect(() => {
    if (initialSlots.length === 0) {
      restoredInitialSlotsSignatureRef.current = ""
      return
    }
    if (drafts.length > 0 || restoredInitialSlotsSignatureRef.current === initialSlotsSignature) return
    restoredInitialSlotsSignatureRef.current = initialSlotsSignature
    const restored = initialSlots.map((slot) => ({ id: makeDraftId(), start: slot.start, end: slot.end }))
    // Restores persisted draft props after hydration; this sync cannot be derived from local state alone.
    setDrafts(restored)
    setActiveDraftId(restored[0]?.id ?? null)
  }, [drafts.length, initialSlots, initialSlotsSignature])

  const changeCalendarView = useCallback((nextView: CalendarView, dateStr?: string) => {
    selectedViewRef.current = nextView
    setView(nextView)
    const calendarApi = calendarRef.current?.getApi()
    if (calendarApi) {
      calendarApi.changeView(nextView, dateStr)
      calendarApi.refetchEvents()
    }
  }, [])

  const getReservationTimeRangeSlots = useCallback((extraSlots: { start: string; end: string }[] = []) => {
    const remoteBookings = Array.from(fetchedRef.current.values()).flatMap((data) =>
      (data.bookings ?? []).map((booking) => ({ start: booking.start, end: booking.end })),
    )
    const focusedSlots = focusSlot ? [{ start: focusSlot.start, end: focusSlot.end }] : []
    return [...drafts, ...remoteBookings, ...focusedSlots, ...extraSlots]
  }, [drafts, focusSlot])

  const applyDynamicTimeRangeBounds = useCallback((extraSlots: { start: string; end: string }[] = []) => {
    const bounds = recomputeTimeRangeBounds(getReservationTimeRangeSlots(extraSlots))
    setSlotMinTime(bounds.slotMinTime)
    setSlotMaxTime(bounds.slotMaxTime)
  }, [getReservationTimeRangeSlots])

  const finishInteraction = useCallback((extraSlots: { start: string; end: string }[] = []) => {
    interactionInProgressRef.current = false
    interactionTypeRef.current = null
    lastTopExpandAtRef.current = null
    lastBottomExpandAtRef.current = null
    applyDynamicTimeRangeBounds(extraSlots)
  }, [applyDynamicTimeRangeBounds])

  useEffect(() => {
    if (interactionInProgressRef.current) return
    applyDynamicTimeRangeBounds()
  }, [applyDynamicTimeRangeBounds])

  useEffect(() => {
    if (adjustRequestKey === 0) return
    // Parent reselect requests must imperatively move the calendar back into adjust mode.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeKind("adjust")
    setAdjustingGroupId(null)
    setAdjustingTitle(null)
    const firstSlot = focusSlot ?? drafts[0] ?? initialSlots[0]
    const frame = window.requestAnimationFrame(() => {
      if (firstSlot) {
        changeCalendarView("timeGridWeek", firstSlot.start)
        if (focusSlot) {
          const start = new Date(focusSlot.start)
          const end = new Date(focusSlot.end)
          const dayStart = new Date(start)
          dayStart.setHours(0, 0, 0, 0)
          const centerStart = new Date(Math.max(dayStart.getTime(), start.getTime() - 90 * 60 * 1000))
          const centerTime = format(centerStart, "HH:mm:ss")
          setSlotMinTime((current) => formatTimeMinutes(Math.min(parseTimeMinutes(current), parseTimeMinutes(centerTime))))
          setSlotMaxTime((current) => formatTimeMinutes(Math.max(parseTimeMinutes(current), Math.ceil((end.getHours() * 60 + end.getMinutes()) / 30) * 30)))
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              calendarRef.current?.getApi().scrollToTime(centerTime)
              rootRef.current
                ?.querySelector<HTMLElement>(`.fc-timegrid-slot-lane[data-time="${centerTime}"], .fc-timegrid-slot[data-time="${centerTime}"]`)
                ?.scrollIntoView({ block: "start" })
            })
          })
        }
      } else {
        changeCalendarView("timeGridWeek")
      }
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [adjustRequestKey, changeCalendarView, drafts, focusSlot, initialSlots])

  const fetchEvents = useCallback(async (arg: EventSourceFuncArg): Promise<EventInput[]> => {
    const cacheKey = `${arg.startStr}|${arg.endStr}`
    let data = fetchedRef.current.get(cacheKey)
    if (!data) {
      data = await fetchFreeBusy(arg)
      fetchedRef.current.set(cacheKey, data)
    }
    const busyEvents = (data.busy ?? []).map((slot) => toBusyEvent(slot))
    const bookingEvents = (data.bookings ?? []).map((booking) =>
      toBookingEvent(booking, modeKind === "adjust" && booking.bookingGroupId === adjustingGroupId),
    )
    const bufferEvents: EventInput[] = []
    for (const booking of data.bookings ?? []) {
      if (booking.status !== "CONFIRMED") continue
      const startMs = new Date(booking.start).getTime()
      const endMs = new Date(booking.end).getTime()
      bufferEvents.push({
        id: `buffer-before-${booking.id}`,
        title: "本予約前後 2 時間は保護領域",
        start: new Date(startMs - 7200000).toISOString(),
        end: booking.start,
        display: "background",
        classNames: ["booking-calendar__confirmed-buffer"],
        editable: false,
        startEditable: false,
        durationEditable: false,
        extendedProps: { kind: "buffer" },
      })
      bufferEvents.push({
        id: `buffer-after-${booking.id}`,
        title: "本予約前後 2 時間は保護領域",
        start: booking.end,
        end: new Date(endMs + 7200000).toISOString(),
        display: "background",
        classNames: ["booking-calendar__confirmed-buffer"],
        editable: false,
        startEditable: false,
        durationEditable: false,
        extendedProps: { kind: "buffer" },
      })
    }
    return [...busyEvents, ...bookingEvents, ...bufferEvents]
  }, [adjustingGroupId, modeKind])

  const draftEventInputs = useMemo<EventInput[]>(
    () => drafts.map((draft) => toDraftEventInput(draft, draft.id === activeDraftId)),
    [drafts, activeDraftId],
  )

  const eventSources = useMemo(
    () => [
      {
        id: "remote-events",
        events: fetchEvents,
      },
      {
        id: "draft-events",
        events: (_arg: EventSourceFuncArg, success: (events: EventInput[]) => void) => {
          success(draftEventInputs)
        },
      },
    ],
    [draftEventInputs, fetchEvents],
  )

  const refetchRemoteEvents = useCallback(() => {
    fetchedRef.current.clear()
    calendarRef.current?.getApi().getEventSourceById("remote-events")?.refetch()
  }, [])

  const refetchDraftEvents = useCallback(() => {
    calendarRef.current?.getApi().getEventSourceById("draft-events")?.refetch()
  }, [])

  useEffect(() => {
    if (interactionInProgressRef.current) return
    refetchDraftEvents()
  }, [draftEventInputs, refetchDraftEvents])

  const upsertDraft = useCallback((draft: DraftEvent, makeActive = true) => {
    setDrafts((prev) => {
      const existing = prev.findIndex((item) => item.id === draft.id)
      if (existing >= 0) {
        const next = [...prev]
        next[existing] = draft
        return next
      }
      return [...prev, draft]
    })
    if (makeActive) setActiveDraftId(draft.id)
    setActionError(null)
  }, [])

  const removeDraft = useCallback((draftId: string) => {
    calendarRef.current?.getApi().getEventById(draftId)?.remove()
    setDrafts((prev) => prev.filter((draft) => draft.id !== draftId))
    setActiveDraftId((current) => (current === draftId ? null : current))
    setDraftPreview((current) => {
      const next = current?.id === draftId ? null : current
      draftPreviewRef.current = next
      return next
    })
    setActionPanelPosition(null)
    setWarningModal(null)
    setActionError(null)
    refetchDraftEvents()
  }, [refetchDraftEvents])

  const updateDraftRange = useCallback((draftId: string, start: Date, end: Date) => {
    const nextStart = start.toISOString()
    const nextEnd = end.toISOString()
    setDrafts((prev) =>
      prev.map((draft) =>
        draft.id === draftId && (draft.start !== nextStart || draft.end !== nextEnd)
          ? { ...draft, start: nextStart, end: nextEnd }
          : draft,
      ),
    )
    setActiveDraftId(draftId)
    setActionError(null)
  }, [])

  const handledResetRequestKeyRef = useRef(0)
  useEffect(() => {
    if (resetRequestKey === 0 || handledResetRequestKeyRef.current === resetRequestKey) return
    handledResetRequestKeyRef.current = resetRequestKey
    const calendarApi = calendarRef.current?.getApi()
    calendarApi?.getEvents().forEach((event) => {
      const props = event.extendedProps as AnyEventProps
      if (props.kind === "draft") event.remove()
    })
    setDrafts([])
    setActiveDraftId(null)
    setDraftPreviewValue(null)
    setActionPanelPosition(null)
    setWarningModal(null)
    setActionError(null)
    refetchDraftEvents()
  }, [refetchDraftEvents, resetRequestKey, setDraftPreviewValue])

  const overlapsBlockedEvent = useCallback((start: Date, end: Date, excludeBookingId?: string): boolean => {
    for (const data of fetchedRef.current.values()) {
      for (const slot of data.busy ?? []) {
        if (rangesOverlap(start, end, slot.start, slot.end)) return true
      }
      for (const booking of data.bookings ?? []) {
        if (booking.id === excludeBookingId) continue
        if (rangesOverlap(start, end, booking.start, booking.end)) return true
      }
    }
    return false
  }, [])

  const overlapsConfirmedBufferZone = useCallback((start: Date, end: Date, excludeBookingId?: string): boolean => {
    for (const data of fetchedRef.current.values()) {
      for (const booking of data.bookings ?? []) {
        if (booking.id === excludeBookingId) continue
        if (booking.status !== "CONFIRMED") continue
        const bufferStart = new Date(new Date(booking.start).getTime() - 7200000).toISOString()
        const bufferEnd = new Date(new Date(booking.end).getTime() + 7200000).toISOString()
        if (rangesOverlap(start, end, bufferStart, bufferEnd)) return true
      }
    }
    return false
  }, [])

  useEffect(() => {
    refetchRemoteEvents()
  }, [adjustingGroupId, modeKind, refetchRemoteEvents])

  const cancelActiveDraft = useCallback(() => {
    if (!activeDraftId) return
    removeDraft(activeDraftId)
  }, [activeDraftId, removeDraft])

  const updateActionPanelPosition = useCallback(() => {
    if (!activeDraftId || view !== "timeGridWeek") {
      setActionPanelPosition(null)
      return
    }
    window.requestAnimationFrame(() => {
      const rootRect = rootRef.current?.getBoundingClientRect()
      const eventEl =
        rootRef.current?.querySelector<HTMLElement>(".fc-event-mirror.booking-calendar__draft, .fc-event-dragging.booking-calendar__draft, .fc-event-resizing.booking-calendar__draft") ??
        rootRef.current?.querySelector<HTMLElement>(`[data-draft-id="${activeDraftId}"]`)
      if (!rootRect || !eventEl) return
      const eventRect = eventEl.getBoundingClientRect()
      const panelRect = actionPanelRef.current?.getBoundingClientRect()
      const panelWidth = panelRect?.width ?? 0
      const fallbackLeft = Math.max(12, eventRect.left - rootRect.left)
      const rawLeft = eventRect.left + eventRect.width / 2 - rootRect.left - panelWidth / 2
      const maxLeft = rootRect.width - panelWidth - 12
      const nextPosition = {
        top: eventRect.bottom - rootRect.top + 8,
        left: panelWidth > 0 ? Math.max(12, Math.min(maxLeft, rawLeft)) : fallbackLeft,
      }
      setActionPanelPosition((current) => {
        if (current && Math.abs(current.top - nextPosition.top) < 0.5 && Math.abs(current.left - nextPosition.left) < 0.5) {
          return current
        }
        return nextPosition
      })
    })
  }, [activeDraftId, view])

  useEffect(() => {
    if (!activeDraftId || view !== "timeGridWeek") {
      // The floating action panel is DOM-positioned and must be cleared when its anchor disappears.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActionPanelPosition(null)
    }
  }, [activeDraftId, view])

  useEffect(() => {
    // Re-measures FullCalendar DOM after draft geometry changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updateActionPanelPosition()
  }, [activeDraftId, activePanelDraft?.start, activePanelDraft?.end, updateActionPanelPosition])

  useEffect(() => {
    if (!activePanelDraft || view !== "timeGridWeek" || !actionPanelPosition || !actionPanelRef.current) return
    const frame = window.requestAnimationFrame(updateActionPanelPosition)
    return () => window.cancelAnimationFrame(frame)
  }, [activePanelDraft, actionPanelPosition, updateActionPanelPosition, view])

  const previewDraftFromEvent = useCallback((event: EventApi) => {
    const props = event.extendedProps as AnyEventProps
    if (props.kind !== "draft" || !props.draftId || !event.start || !event.end) return
    setDraftPreviewValue({
      id: props.draftId,
      start: event.start.toISOString(),
      end: event.end.toISOString(),
      sourceKind: props.sourceKind,
    })
    setActiveDraftId(props.draftId)
  }, [setDraftPreviewValue])

  const handleEventDragStart = useCallback((arg: EventDragStartArg) => {
    const props = arg.event.extendedProps as AnyEventProps
    if (props.kind !== "draft") return
    interactionInProgressRef.current = true
    interactionTypeRef.current = "drag"
    lastTopExpandAtRef.current = null
    lastBottomExpandAtRef.current = null
    previewDraftFromEvent(arg.event)
  }, [previewDraftFromEvent])

  const handleEventDragStop = useCallback((arg: EventDragStopArg) => {
    const props = arg.event.extendedProps as AnyEventProps
    const preview = draftPreviewRef.current
    if (props.kind === "draft" && props.draftId && preview?.id === props.draftId) {
      updateDraftRange(preview.id, new Date(preview.start), new Date(preview.end))
    }
    finishInteraction(preview ? [{ start: preview.start, end: preview.end }] : [])
    setDraftPreviewValue(null)
  }, [finishInteraction, setDraftPreviewValue, updateDraftRange])

  const handleEventResizeStart = useCallback((arg: EventResizeStartArg) => {
    const props = arg.event.extendedProps as AnyEventProps
    if (props.kind !== "draft") return
    interactionInProgressRef.current = true
    interactionTypeRef.current = "resize"
    lastTopExpandAtRef.current = null
    lastBottomExpandAtRef.current = null
    previewDraftFromEvent(arg.event)
  }, [previewDraftFromEvent])

  const handleEventResizeStop = useCallback((arg: EventResizeStopArg) => {
    const props = arg.event.extendedProps as AnyEventProps
    const preview = draftPreviewRef.current
    if (props.kind === "draft" && props.draftId && preview?.id === props.draftId) {
      updateDraftRange(preview.id, new Date(preview.start), new Date(preview.end))
    }
    finishInteraction(preview ? [{ start: preview.start, end: preview.end }] : [])
    setDraftPreviewValue(null)
  }, [finishInteraction, setDraftPreviewValue, updateDraftRange])

  const handleCalendarMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (selectedViewRef.current === "dayGridMonth" || event.button !== 0) return
    const target = event.target instanceof Element ? event.target : null
    if (!target) return
    if (target.closest(".fc-event, button, a, input, textarea, select")) return
    if (!target.closest(".fc-timegrid-body, .fc-timegrid-cols, .fc-timegrid-col, .fc-timegrid-slot")) return
    interactionInProgressRef.current = true
    interactionTypeRef.current = "select"
    lastTopExpandAtRef.current = null
    lastBottomExpandAtRef.current = null
  }, [])

  const expandTimeRangeAtClientY = useCallback((clientY: number) => {
    if (selectedViewRef.current === "dayGridMonth" || !interactionInProgressRef.current) return
    if (interactionTypeRef.current === "resize") return
    const scrollEl =
      rootRef.current?.querySelector<HTMLElement>(".fc-timegrid-body") ??
      rootRef.current?.querySelector<HTMLElement>(".fc-scroller-liquid-absolute")
    if (!scrollEl) return
    const rect = scrollEl.getBoundingClientRect()
    const inTopZone = clientY - rect.top <= 30
    const inBottomZone = rect.bottom - clientY <= 30
    const now = Date.now()

    if (inTopZone && (lastTopExpandAtRef.current === null || now - lastTopExpandAtRef.current >= TIME_RANGE_EXPAND_THROTTLE_MS)) {
      lastTopExpandAtRef.current = now
      setSlotMinTime((current) => {
        return formatTimeMinutes(parseTimeMinutes(current) - TIME_RANGE_EXPAND_STEP_MINUTES)
      })
    }
    if (!inTopZone) lastTopExpandAtRef.current = null

    if (inBottomZone && (lastBottomExpandAtRef.current === null || now - lastBottomExpandAtRef.current >= TIME_RANGE_EXPAND_THROTTLE_MS)) {
      lastBottomExpandAtRef.current = now
      setSlotMaxTime((current) => {
        return formatTimeMinutes(parseTimeMinutes(current) + TIME_RANGE_EXPAND_STEP_MINUTES)
      })
    }
    if (!inBottomZone) lastBottomExpandAtRef.current = null
  }, [])

  const handleCalendarMouseMoveCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    expandTimeRangeAtClientY(event.clientY)
  }, [expandTimeRangeAtClientY])

  useEffect(() => {
    function expandTimeRange(event: MouseEvent) {
      if (selectedViewRef.current === "dayGridMonth" || !interactionInProgressRef.current) {
        lastTopExpandAtRef.current = null
        lastBottomExpandAtRef.current = null
        return
      }

      expandTimeRangeAtClientY(event.clientY)
    }

    window.addEventListener("mousemove", expandTimeRange)
    return () => window.removeEventListener("mousemove", expandTimeRange)
  }, [expandTimeRangeAtClientY])

  useEffect(() => {
    function stopSelectInteraction() {
      finishInteraction()
    }

    window.addEventListener("pointerup", stopSelectInteraction)
    window.addEventListener("pointercancel", stopSelectInteraction)
    window.addEventListener("mouseup", stopSelectInteraction)
    return () => {
      window.removeEventListener("pointerup", stopSelectInteraction)
      window.removeEventListener("pointercancel", stopSelectInteraction)
      window.removeEventListener("mouseup", stopSelectInteraction)
    }
  }, [finishInteraction])

  const handleSelect = useCallback((arg: DateSelectArg) => {
    const calendarApi = calendarRef.current?.getApi()
    if (
      !isSelectableView(arg.view.type) ||
      !hasMinimumSelectionDuration(arg.start, arg.end) ||
      overlapsBlockedEvent(arg.start, arg.end) ||
      overlapsConfirmedBufferZone(arg.start, arg.end)
    ) {
      finishInteraction()
      calendarApi?.unselect()
      return
    }
    const draft: DraftEvent = {
      id: makeDraftId(),
      start: arg.start.toISOString(),
      end: arg.end.toISOString(),
    }
    finishInteraction([{ start: draft.start, end: draft.end }])
    upsertDraft(draft, true)
    calendarApi?.unselect()
  }, [finishInteraction, overlapsBlockedEvent, overlapsConfirmedBufferZone, upsertDraft])

  const handleUnselect = useCallback(() => {
    finishInteraction()
  }, [finishInteraction])

  const handleSelectAllow = useCallback<AllowFunc>((span) => {
    return (
      isSelectableView(selectedViewRef.current) &&
      hasMinimumSelectionDuration(span.start, span.end) &&
      !overlapsBlockedEvent(span.start, span.end) &&
      !overlapsConfirmedBufferZone(span.start, span.end)
    )
  }, [overlapsBlockedEvent, overlapsConfirmedBufferZone])

  const handleEventAllow = useCallback<AllowFunc>((span, movingEvent) => {
    const props = movingEvent?.extendedProps as AnyEventProps | undefined
    if (props?.status === "CONFIRMED") return false
    const allowed =
      !overlapsBlockedEvent(span.start, span.end, props?.bookingId) &&
      !overlapsConfirmedBufferZone(span.start, span.end, props?.bookingId)
    if (allowed && props?.kind === "draft" && props.draftId) {
      const preview = {
        id: props.draftId,
        start: span.start.toISOString(),
        end: span.end.toISOString(),
        sourceKind: props.sourceKind,
      }
      setDraftPreviewValue({
        id: preview.id,
        start: preview.start,
        end: preview.end,
        sourceKind: preview.sourceKind,
      })
      setActiveDraftId(props.draftId)
      if (interactionTypeRef.current === "resize") {
        applyDynamicTimeRangeBounds([{ start: preview.start, end: preview.end }])
      }
    }
    return allowed
  }, [applyDynamicTimeRangeBounds, overlapsBlockedEvent, overlapsConfirmedBufferZone, setDraftPreviewValue])

  const handleDateClick = useCallback(
    (arg: DateClickArg) => {
      if (arg.view.type === "dayGridMonth") {
        changeCalendarView("timeGridWeek", arg.dateStr)
      }
    },
    [changeCalendarView],
  )

  const handleEventClick = useCallback((arg: EventClickArg) => {
    const props = arg.event.extendedProps as AnyEventProps
    if (props.kind === "draft" && props.draftId) {
      setActiveDraftId(props.draftId)
      setActionError(null)
      return
    }
  }, [])

  const handleEventDrop = useCallback(
    (arg: EventDropArg) => {
      const props = arg.event.extendedProps as AnyEventProps
      const newStart = arg.event.start
      const newEnd = arg.event.end
      if (!newStart || !newEnd) {
        arg.revert()
        return
      }
      if (
        overlapsBlockedEvent(newStart, newEnd, props.bookingId) ||
        overlapsConfirmedBufferZone(newStart, newEnd, props.bookingId)
      ) {
        arg.revert()
        return
      }

      if (props.kind === "draft" && props.draftId) {
        updateDraftRange(props.draftId, newStart, newEnd)
        setDraftPreviewValue(null)
        return
      }

      if (props.kind === "busy" && props.bookingId) {
        arg.revert()
        if (modeKind !== "adjust" || props.bookingGroupId !== adjustingGroupId) return
        setMoveCopyPopup({
          bookingId: props.bookingId,
          start: newStart.toISOString(),
          end: newEnd.toISOString(),
          x: arg.jsEvent.clientX,
          y: arg.jsEvent.clientY,
        })
        return
      }

      arg.revert()
    },
    [adjustingGroupId, modeKind, overlapsBlockedEvent, overlapsConfirmedBufferZone, setDraftPreviewValue, updateDraftRange],
  )

  const handleEventResize = useCallback((arg: EventResizeDoneArg) => {
    const props = arg.event.extendedProps as AnyEventProps
    const newStart = arg.event.start
    const newEnd = arg.event.end
    if (!newStart || !newEnd) {
      arg.revert()
      return
    }
    if (
      overlapsBlockedEvent(newStart, newEnd, props.bookingId) ||
      overlapsConfirmedBufferZone(newStart, newEnd, props.bookingId)
    ) {
      arg.revert()
      return
    }
    if (props.kind === "draft" && props.draftId) {
      updateDraftRange(props.draftId, newStart, newEnd)
      setDraftPreviewValue(null)
      return
    }
    arg.revert()
  }, [overlapsBlockedEvent, overlapsConfirmedBufferZone, setDraftPreviewValue, updateDraftRange])

  const dayCellClassNames = (arg: DayCellContentArg): string[] => {
    const classes: string[] = []
    const day = arg.date.getDay()
    if (day === 0 || day === 6) classes.push("booking-calendar__weekend")
    if (getHolidayName(arg.date)) classes.push("booking-calendar__holiday")
    return classes
  }

  const handleDayCellDidMount = (arg: DayCellMountArg) => {
    if (arg.view.type !== "dayGridMonth") return

    const holidayName = getHolidayName(arg.date)
    const cellTop = arg.el.querySelector<HTMLElement>(".fc-daygrid-day-top")
    const dayNumber = arg.el.querySelector<HTMLElement>(".fc-daygrid-day-number")

    cellTop?.classList.add("booking-calendar__day-cell")
    dayNumber?.classList.add("booking-calendar__day-number")

    if (holidayName && cellTop && !cellTop.querySelector(".booking-calendar__holiday-label")) {
      const holidayLabel = document.createElement("span")
      holidayLabel.className = "booking-calendar__holiday-label"
      holidayLabel.textContent = holidayName
      cellTop.appendChild(holidayLabel)
    }
  }

  const removeExistingSlot = useCallback(
    async (bookingId: string) => {
      const response = await fetch(`/api/booking/${bookingId}`, { method: "DELETE" })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        setActionError(mapErrorCodeToJa(payload.error ?? "unknown"))
        return
      }
      refetchRemoteEvents()
    },
    [refetchRemoteEvents],
  )

  const handleEventDidMount = (arg: EventMountArg) => {
    const props = arg.event.extendedProps as AnyEventProps
    if (props.kind === "draft") {
      arg.el.setAttribute("data-active-draft", props.draftId === activeDraftId ? "true" : "false")
      if (props.draftId) arg.el.setAttribute("data-draft-id", props.draftId)
      if (props.draftId === activeDraftId && arg.view.type === "timeGridWeek") {
        updateActionPanelPosition()
      }
      if (props.draftId) {
        const removeButton = document.createElement("button")
        removeButton.type = "button"
        removeButton.className = "booking-calendar__slot-remove"
        removeButton.dataset.testid = "booking-slot-remove"
        removeButton.dataset.slotKind = "draft"
        removeButton.setAttribute("aria-label", "日時を削除")
        removeButton.textContent = "×"
        removeButton.addEventListener("click", (event) => {
          event.preventDefault()
          event.stopPropagation()
          removeDraft(props.draftId!)
        })
        arg.el.appendChild(removeButton)
      }
      return
    }
    if (props.kind !== "busy") return
    if (props.bookingId && props.bookingGroupId === adjustingGroupId) {
      const removeButton = document.createElement("button")
      removeButton.type = "button"
      removeButton.className = "booking-calendar__slot-remove"
      removeButton.dataset.testid = "booking-slot-remove"
      removeButton.dataset.slotKind = "booking"
      removeButton.setAttribute("aria-label", "日時を削除")
      removeButton.textContent = "×"
      removeButton.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        void removeExistingSlot(props.bookingId!)
      })
      arg.el.appendChild(removeButton)
    }
  }

  const renderEventContent = (arg: EventContentArg) => {
    const props = arg.event.extendedProps as AnyEventProps
    if (props.kind === "draft") {
      return (
        <span className="booking-calendar__draft-range">
          {arg.event.start && arg.event.end ? `${format(arg.event.start, "HH:mm")} - ${format(arg.event.end, "HH:mm")}` : ""}
        </span>
      )
    }
    if (props.kind === "busy") {
      const isMonthView = arg.view.type === "dayGridMonth"
      const lockIcon = (
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      )
      const statusLabel = props.status ? (props.status === "CONFIRMED" ? "本予約" : "仮予約") : "予約不可"
      const shortLabel = props.status ? (props.status === "CONFIRMED" ? "本" : "仮") : "不"
      const rangeLabel = props.label ?? (arg.event.start && arg.event.end ? `${format(arg.event.start, "HH:mm")}-${format(arg.event.end, "HH:mm")}` : "")
      const monthTimeLabel = arg.event.allDay ? "終日" : arg.event.start ? format(arg.event.start, "HH:mm") : rangeLabel
      const text = isMonthView ? `${monthTimeLabel} ${shortLabel}` : `${statusLabel} ${rangeLabel}`.trim()
      return (
        <span className="booking-calendar__busy-pill-content">
          {lockIcon}
          <span className="booking-calendar__booking-label">{text}</span>
        </span>
      )
    }
    return undefined
  }

  const runPreflight = useCallback(
    async (slot: { start: string; end: string }, kind: BookingKind): Promise<BookingConflictsResponse> => {
      const response = await fetch("/api/booking/conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingKind: kind,
          start: slot.start,
          end: slot.end,
        }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(mapErrorCodeToJa(payload.error ?? "unknown"))
      }
      return (await response.json()) as BookingConflictsResponse
    },
    [],
  )

  const startCommit = useCallback(
    async (kind: BookingKind) => {
      if (!activeDraft || preflighting) return
      const slots = drafts.length > 0 ? drafts.map((draft) => ({ start: draft.start, end: draft.end })) : [{ start: activeDraft.start, end: activeDraft.end }]
      const slot = { start: activeDraft.start, end: activeDraft.end }
      setPreflighting(true)
      setActionError(null)
      try {
        const verdict = await runPreflight(slot, kind)
        setActionPanelPosition(null)
        if (verdict.verdict === "block") {
          setActionError(verdict.message)
          return
        }
        if (verdict.verdict === "warn") {
          setWarningModal({ kind, message: verdict.message, slot })
          return
        }
        onCommit(slots, kind)
      } catch (error) {
        const message = error instanceof Error ? error.message : "予約の重なり確認に失敗しました"
        setActionError(message)
      } finally {
        setPreflighting(false)
      }
    },
    [activeDraft, drafts, onCommit, preflighting, runPreflight],
  )

  const confirmAfterWarning = useCallback(() => {
    if (!warningModal) return
    const slots = drafts.length > 0 ? drafts.map((draft) => ({ start: draft.start, end: draft.end })) : [warningModal.slot]
    onCommit(slots, warningModal.kind)
    setWarningModal(null)
  }, [drafts, onCommit, warningModal])

  const executeMoveCopy = useCallback(
    async (action: "move" | "copy") => {
      if (!moveCopyPopup) return
      const response = await fetch(`/api/booking/${moveCopyPopup.bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          start: moveCopyPopup.start,
          end: moveCopyPopup.end,
        }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        setActionError(mapErrorCodeToJa(payload.error ?? "unknown"))
        return
      }
      setMoveCopyPopup(null)
      refetchRemoteEvents()
    },
    [moveCopyPopup, refetchRemoteEvents],
  )

  return (
    <div
      className="booking-calendar"
      ref={rootRef}
      onMouseDownCapture={handleCalendarMouseDownCapture}
      onMouseMoveCapture={handleCalendarMouseMoveCapture}
    >
      <div className="booking-calendar__view-row">
        <div className="booking-calendar__tabs" aria-label="カレンダー表示切替">
          {VIEW_OPTIONS.map((option) => {
            const isActive = view === option.value
            return (
              <button
                key={option.value}
                type="button"
                data-view={option.value === "dayGridMonth" ? "month" : option.value === "timeGridWeek" ? "week" : "day"}
                className={`booking-calendar__tab ${isActive ? "glass-inset text-hp" : "glass-flat text-hp-muted"}`}
                aria-pressed={isActive}
                onClick={() => changeCalendarView(option.value)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
        {modeKind === "adjust" ? (
          <div className="booking-calendar__adjust-badge glass-inset">
            {(adjustingTitle ?? projectTitle)?.trim() ? `${(adjustingTitle ?? projectTitle)!.trim()}案件の日時調整中` : "日時調整中"}
          </div>
        ) : null}
      </div>
      {activePanelDraft && view === "timeGridWeek" && actionPanelPosition ? (
        <div
          ref={actionPanelRef}
          className="booking-calendar__action-panel glass-flat"
          data-testid="booking-action-panel"
          style={{ top: actionPanelPosition.top, left: actionPanelPosition.left }}
        >
          <div className="booking-calendar__action-panel-info">
            <span className="booking-calendar__action-panel-range">
              {formatRange(activePanelDraft.start, activePanelDraft.end)}
            </span>
          </div>
          <div className="booking-calendar__action-panel-buttons">
            <button
              type="button"
              className="booking-calendar__action-button booking-calendar__action-button--primary"
              onClick={() => startCommit("confirmed")}
              disabled={preflighting}
            >
              {preflighting ? "確認中…" : "本予約"}
            </button>
            <button
              type="button"
              className="booking-calendar__action-button"
              onClick={() => startCommit("tentative")}
              disabled={preflighting}
            >
              仮キープ
            </button>
            <button
              type="button"
              className="booking-calendar__action-button booking-calendar__action-button--ghost"
              onClick={cancelActiveDraft}
              disabled={preflighting}
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : null}
      {actionError ? (
        <div className="booking-calendar__action-error glass-flat" role="alert">
          {actionError}
        </div>
      ) : null}
      <div className="booking-calendar__surface glass-flat">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale={jaLocale}
          firstDay={0}
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "",
          }}
          buttonText={{
            today: "今日",
          }}
          height="auto"
          selectable={view === "timeGridWeek"}
          selectAllow={handleSelectAllow}
          selectOverlap={false}
          eventAllow={handleEventAllow}
          selectMinDistance={16}
          selectMirror
          unselectAuto={false}
          editable={false}
          eventStartEditable
          eventDurationEditable
          eventResizableFromStart
          nowIndicator
          slotMinTime={slotMinTime}
          slotMaxTime={slotMaxTime}
          slotDuration="00:30:00"
          snapDuration="00:30:00"
          allDaySlot={false}
          navLinks
          navLinkDayClick={(date) => changeCalendarView("timeGridDay", toDateKey(date))}
          eventSources={eventSources}
          eventContent={renderEventContent}
          eventDidMount={handleEventDidMount}
          dayCellClassNames={dayCellClassNames}
          dayCellDidMount={handleDayCellDidMount}
          dateClick={handleDateClick}
          select={handleSelect}
          unselect={handleUnselect}
          eventClick={handleEventClick}
          eventDragStart={handleEventDragStart}
          eventDragStop={handleEventDragStop}
          eventDrop={handleEventDrop}
          eventResizeStart={handleEventResizeStart}
          eventResizeStop={handleEventResizeStop}
          eventResize={handleEventResize}
        />
      </div>
      {moveCopyPopup ? (
        <div
          className="booking-calendar__move-copy-popup glass-flat"
          role="dialog"
          aria-modal="false"
          style={{ left: moveCopyPopup.x, top: moveCopyPopup.y }}
        >
          <button type="button" className="booking-calendar__action-button" onClick={() => void executeMoveCopy("move")}>
            Move
          </button>
          <button type="button" className="booking-calendar__action-button" onClick={() => void executeMoveCopy("copy")}>
            Copy
          </button>
          <button type="button" className="booking-calendar__action-button booking-calendar__action-button--ghost" onClick={() => setMoveCopyPopup(null)}>
            Cancel
          </button>
        </div>
      ) : null}
      {warningModal ? (
        <div
          className="booking-calendar__modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="booking-warning-title"
        >
          <div className="booking-calendar__modal-card glass-flat">
            <h2 id="booking-warning-title" className="booking-calendar__modal-title">
              重なりがあります
            </h2>
            <p className="booking-calendar__modal-message">{warningModal.message}</p>
            <div className="booking-calendar__modal-actions">
              <button
                type="button"
                className="booking-calendar__action-button booking-calendar__action-button--ghost"
                onClick={() => setWarningModal(null)}
              >
                やめる
              </button>
              <button
                type="button"
                className="booking-calendar__action-button booking-calendar__action-button--primary"
                onClick={confirmAfterWarning}
              >
                {warningModal.kind === "tentative" ? "仮キープする" : "確定する"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
