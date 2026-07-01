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
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from "react"
import { signOut } from "next-auth/react"

import { mapErrorCodeToJa, type BookingConflictsResponse } from "@/lib/booking/domain/api-schema"
import { getHolidayName } from "@/lib/booking/domain/holidays"
import type { BookingSlot } from "@/lib/booking/domain/form-schema"

type TeamOption = {
  id: string
  name: string
  members: { userId: string; name: string | null; email: string | null }[]
}

type CalendarView = "dayGridMonth" | "timeGridWeek" | "timeGridDay"

type BusySlot = {
  start: string
  end: string
  bufferHours?: number | null
  bufferBeforeHours?: number | null
  bufferAfterHours?: number | null
  summary?: string | null
}

type BookingFromApi = {
  id: string
  bookingGroupId: string
  customerUserId: string
  start: string
  end: string
  title: string
  status: BookingStatus | string
  bufferBeforeHours: number
  bufferAfterHours: number
}

type FreeBusyResponse = {
  busy?: BusySlot[]
  bookings?: BookingFromApi[]
  code?: string
}

type CachedRange = {
  teamId: string | null
  startMs: number
  endMs: number
  data: FreeBusyResponse
}

type BookingStatus = "CONFIRMED"

type BusyEventProps = {
  kind: "busy"
  label: string
  status?: BookingStatus
  bookingId?: string
  bookingGroupId?: string
  customerUserId?: string
  projectTitle?: string
  canView?: boolean
  canEdit?: boolean
}

type DraftEventProps = {
  kind: "draft"
  draftId: string
}

type BufferEventProps = {
  kind: "buffer"
  side?: "before" | "after"
  bookingId?: string
  bookingGroupId?: string
  bookingStart?: string
  bookingEnd?: string
  canEdit?: boolean
}

type AnyEventProps = {
  kind?: "draft" | "busy" | "buffer"
  label?: string
  status?: BookingStatus
  bookingId?: string
  bookingGroupId?: string
  customerUserId?: string
  projectTitle?: string
  canView?: boolean
  canEdit?: boolean
  draftId?: string
  side?: "before" | "after"
  bookingStart?: string
  bookingEnd?: string
}

type BufferEdgeAllowProps = Pick<AnyEventProps, "side" | "bookingStart" | "bookingEnd">

type BufferEdgeAllowSpan = {
  start: Date
  end: Date
}

export function shouldAllowBufferEdge(
  props: BufferEdgeAllowProps | undefined,
  span: BufferEdgeAllowSpan,
  isCalendarAdmin: boolean,
) {
  if (!isCalendarAdmin) return false
  if (props?.side === "before" && props.bookingStart) {
    return span.end.getTime() === new Date(props.bookingStart).getTime()
  }
  if (props?.side === "after" && props.bookingEnd) {
    return span.start.getTime() === new Date(props.bookingEnd).getTime()
  }
  return true
}

type DraftEvent = {
  id: string
  start: string
  end: string
}

type ModeKind = "normal" | "adjust"

type MoveCopyPopupState = {
  bookingId: string
  oldStart: string
  oldEnd: string
  start: string
  end: string
  x: number
  y: number
} | null

type AdminMoveConfirmState = {
  bookingId: string
  bookingGroupId: string
  projectTitle: string
  oldStart: string
  oldEnd: string
  newStart: string
  newEnd: string
} | null

type InteractionType = "drag" | "resize" | "select" | null

type TouchTapTarget = {
  date: string
  time: string
  x: number
  y: number
}

const VIEW_OPTIONS: { label: string; value: CalendarView }[] = [
  { label: "月", value: "dayGridMonth" },
  { label: "週", value: "timeGridWeek" },
  { label: "日", value: "timeGridDay" },
]

const MIN_SELECTION_MS = 30 * 60 * 1000
const BOOKING_BUFFER_HOURS = 1
const BASE_SLOT_MIN_MINUTES = 10 * 60
const BASE_SLOT_MAX_MINUTES = 19 * 60
const TIME_RANGE_EXPAND_STEP_MINUTES = 30
const TIME_RANGE_EXPAND_THROTTLE_MS = 200
const MOBILE_CALENDAR_MEDIA_QUERY = "(max-width: 767px)"

function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function parseDateTimeSlot(date: string, time: string): Date | null {
  const [year, month, day] = date.split("-").map(Number)
  const [hours, minutes, seconds = 0] = time.split(":").map(Number)
  if (!year || !month || !day || Number.isNaN(hours) || Number.isNaN(minutes)) return null
  return new Date(year, month - 1, day, hours, minutes, seconds, 0)
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

function resolveBusyBufferHours(slot: BusySlot): { before: number; after: number } {
  const before = slot.bufferBeforeHours ?? slot.bufferHours ?? BOOKING_BUFFER_HOURS
  const after = slot.bufferAfterHours ?? slot.bufferHours ?? BOOKING_BUFFER_HOURS
  return { before, after }
}

function getBusyLabel(slot: BusySlot, isCalendarAdmin: boolean): string {
  if (isFullDayBusySlot(slot)) return "終日"

  if (isCalendarAdmin) {
    return `${format(new Date(slot.start), "HH:mm")}-${format(new Date(slot.end), "HH:mm")}`
  }

  const { before, after } = resolveBusyBufferHours(slot)
  const start = new Date(new Date(slot.start).getTime() - toBufferMs(before))
  const end = new Date(new Date(slot.end).getTime() + toBufferMs(after))

  return `${format(start, "HH:mm")}-${format(end, "HH:mm")}`
}

function toBusyEvent(slot: BusySlot, isCalendarAdmin: boolean): EventInput {
  const allDay = isFullDayBusySlot(slot)
  const label = getBusyLabel(slot, isCalendarAdmin)
  const shouldMergeBuffer = !allDay && !isCalendarAdmin
  const { before, after } = resolveBusyBufferHours(slot)
  const start = shouldMergeBuffer
    ? new Date(new Date(slot.start).getTime() - toBufferMs(before)).toISOString()
    : slot.start
  const end = shouldMergeBuffer
    ? new Date(new Date(slot.end).getTime() + toBufferMs(after)).toISOString()
    : slot.end
  const summary = slot.summary?.trim()
  const extendedProps: BusyEventProps = {
    kind: "busy",
    label,
    canEdit: isCalendarAdmin,
    ...(isCalendarAdmin && summary ? { projectTitle: summary } : {}),
  }

  return {
    id: isCalendarAdmin && !allDay ? `busy-${slot.start}-${slot.end}` : `busy-merged-${slot.start}-${slot.end}`,
    title: "予約不可",
    start,
    end,
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
  viewerUserId: string,
  isCalendarAdmin: boolean,
  teamMemberUserIds: string[],
): EventInput {
  const label = `${format(new Date(booking.start), "HH:mm")}-${format(new Date(booking.end), "HH:mm")}`
  const status = (booking.status as BusyEventProps["status"]) ?? "CONFIRMED"
  const isOwner = booking.customerUserId === viewerUserId
  const isTeamMember = teamMemberUserIds.includes(booking.customerUserId)
  const canView = isCalendarAdmin || isOwner || isTeamMember
  const canEdit = isCalendarAdmin || isOwner
  const isCalendarEditable =
    (editable && canEdit && status !== "CONFIRMED") ||
    (isCalendarAdmin && status === "CONFIRMED")
  const extendedProps: BusyEventProps = {
    kind: "busy",
    label,
    status,
    bookingId: booking.id,
    bookingGroupId: booking.bookingGroupId,
    customerUserId: booking.customerUserId,
    projectTitle: booking.title,
    canView,
    canEdit,
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
      "booking-calendar__booking-event--confirmed",
      canView ? "booking-calendar__booking-event--clickable" : "",
    ].filter(Boolean),
    editable: isCalendarEditable,
    startEditable: isCalendarEditable,
    durationEditable: isCalendarEditable,
    extendedProps,
  }
}

export function shouldConfirmAdminMove(
  props: {
    kind?: "draft" | "busy" | "buffer"
    status?: BookingStatus
    bookingGroupId?: string
    customerUserId?: string
    projectTitle?: string
  },
  viewerUserId: string,
  isCalendarAdmin: boolean,
): boolean {
  return Boolean(
    props.kind === "busy" &&
    isCalendarAdmin &&
    props.status === "CONFIRMED" &&
    props.bookingGroupId &&
    props.projectTitle &&
    props.customerUserId !== undefined &&
    props.customerUserId !== viewerUserId,
  )
}

function toDraftEventInput(
  draft: DraftEvent,
  isActive: boolean,
): EventInput {
  const extendedProps: DraftEventProps = {
    kind: "draft",
    draftId: draft.id,
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

async function fetchFreeBusy(
  start: string,
  end: string,
  teamId: string | null,
): Promise<FreeBusyResponse> {
  const params = new URLSearchParams({
    start,
    end,
  })
  if (teamId) params.set("teamId", teamId)
  const response = await fetch(`/api/calendar/free-busy?${params.toString()}`)

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

function toTime(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

function overlapsRange(item: { start: string; end: string }, startMs: number, endMs: number): boolean {
  return toTime(item.start) < endMs && toTime(item.end) > startMs
}

function filterResponseToRange(data: FreeBusyResponse, startMs: number, endMs: number): FreeBusyResponse {
  return {
    busy: (data.busy ?? []).filter((slot) => overlapsRange(slot, startMs, endMs)),
    bookings: (data.bookings ?? []).filter((booking) => overlapsRange(booking, startMs, endMs)),
    code: data.code,
  }
}

function mergeResponses(responses: FreeBusyResponse[], startMs: number, endMs: number): FreeBusyResponse {
  const busy = new Map<string, BusySlot>()
  const bookings = new Map<string, BookingFromApi>()
  let code: string | undefined

  for (const response of responses) {
    const filtered = filterResponseToRange(response, startMs, endMs)
    code ??= filtered.code
    for (const slot of filtered.busy ?? []) {
      busy.set(
        `${slot.start}|${slot.end}|${slot.bufferHours ?? ""}|${slot.bufferBeforeHours ?? ""}|${slot.bufferAfterHours ?? ""}`,
        slot,
      )
    }
    for (const booking of filtered.bookings ?? []) {
      bookings.set(booking.id, booking)
    }
  }

  return {
    busy: Array.from(busy.values()),
    bookings: Array.from(bookings.values()),
    code,
  }
}

function missingRanges(startMs: number, endMs: number, cachedRanges: CachedRange[]): { startMs: number; endMs: number }[] {
  const ranges = cachedRanges
    .filter((range) => range.startMs < endMs && range.endMs > startMs)
    .sort((a, b) => a.startMs - b.startMs)
  const missing: { startMs: number; endMs: number }[] = []
  let cursor = startMs

  for (const range of ranges) {
    if (range.startMs > cursor) {
      missing.push({ startMs: cursor, endMs: Math.min(range.startMs, endMs) })
    }
    cursor = Math.max(cursor, range.endMs)
    if (cursor >= endMs) break
  }
  if (cursor < endMs) missing.push({ startMs: cursor, endMs })

  return missing
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
  return viewType === "timeGridWeek" || viewType === "timeGridDay"
}

function getSelectionView(isMobileCalendar: boolean): CalendarView {
  return isMobileCalendar ? "timeGridDay" : "timeGridWeek"
}

function hasMinimumSelectionDuration(start: Date, end: Date): boolean {
  return end.getTime() - start.getTime() >= MIN_SELECTION_MS
}

function rangesOverlap(start: Date, end: Date, otherStart: string, otherEnd: string): boolean {
  return start.getTime() < new Date(otherEnd).getTime() && end.getTime() > new Date(otherStart).getTime()
}

function toBufferMs(hours: number): number {
  return Math.max(0, hours) * 60 * 60 * 1000
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

export function recomputeTimeRangeBounds(
  slots: { start: string; end: string }[],
  visibleRange?: { start: Date; end: Date },
): { slotMinTime: string; slotMaxTime: string } {
  const allMinutes: number[] = []

  for (const slot of slots) {
    const startDate = new Date(slot.start)
    const endDate = new Date(slot.end)
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) continue
    if (endDate.getTime() <= startDate.getTime()) continue

    const clipStart = visibleRange
      ? new Date(Math.max(startDate.getTime(), visibleRange.start.getTime()))
      : startDate
    const clipEnd = visibleRange
      ? new Date(Math.min(endDate.getTime(), visibleRange.end.getTime()))
      : endDate
    if (clipEnd.getTime() <= clipStart.getTime()) continue

    let cursor = new Date(clipStart)
    while (cursor.getTime() < clipEnd.getTime()) {
      const dayStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 0, 0, 0, 0)
      const nextDayStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
      const segmentEnd = new Date(Math.min(clipEnd.getTime(), nextDayStart.getTime()))
      const startMinutes = Math.round((cursor.getTime() - dayStart.getTime()) / 60000)
      const endMinutes = Math.round((segmentEnd.getTime() - dayStart.getTime()) / 60000)
      allMinutes.push(startMinutes, endMinutes)
      cursor = nextDayStart
    }
  }

  if (allMinutes.length === 0) {
    return {
      slotMinTime: formatTimeMinutes(BASE_SLOT_MIN_MINUTES),
      slotMaxTime: formatTimeMinutes(BASE_SLOT_MAX_MINUTES),
    }
  }

  const minMinutes = Math.min(BASE_SLOT_MIN_MINUTES, ...allMinutes)
  const maxMinutes = Math.max(BASE_SLOT_MAX_MINUTES, ...allMinutes)

  return {
    slotMinTime: formatTimeMinutes(Math.max(0, minMinutes)),
    slotMaxTime: formatTimeMinutes(Math.min(24 * 60, maxMinutes)),
  }
}

type BookingCalendarProps = {
  viewerUserId: string
  viewerEmail: string
  isCalendarAdmin: boolean
  teamMemberUserIds: string[]
  initialSlots?: { start: string; end: string }[]
  initialBusy?: BusySlot[]
  initialBookings?: BookingFromApi[]
  initialRange?: { start: string; end: string }
  projectTitle?: string
  adjustRequestKey?: number
  resetRequestKey?: number
  remoteRefreshRequestKey?: number
  focusSlot?: BookingSlot | null
  teams?: TeamOption[]
  selectedTeamId?: string | null
  onSelectedTeamIdChange?: (teamId: string | null) => void
  monthSkeleton?: ReactNode
  onCommit: (slots: { start: string; end: string }[]) => void
  onCodeChange?: (code: string | null) => void
}

export function BookingCalendar({
  viewerUserId,
  viewerEmail,
  isCalendarAdmin,
  teamMemberUserIds,
  initialSlots = [],
  initialBusy = [],
  initialBookings = [],
  initialRange,
  projectTitle,
  adjustRequestKey = 0,
  resetRequestKey = 0,
  remoteRefreshRequestKey = 0,
  focusSlot = null,
  teams = [],
  selectedTeamId = null,
  onSelectedTeamIdChange,
  monthSkeleton,
  onCommit,
  onCodeChange,
}: BookingCalendarProps) {
  const [view, setView] = useState<CalendarView>("dayGridMonth")
  const [isMobileCalendar, setIsMobileCalendar] = useState(false)
  const [isFullCalendarReady, setIsFullCalendarReady] = useState(false)
  const [isMonthSkeletonMounted, setIsMonthSkeletonMounted] = useState(() => Boolean(monthSkeleton))
  const [isMonthSkeletonFading, setIsMonthSkeletonFading] = useState(false)
  const [modeKind, setModeKind] = useState<ModeKind>("normal")
  const [adjustingGroupId, setAdjustingGroupId] = useState<string | null>(null)
  const [adjustingTitle, setAdjustingTitle] = useState<string | null>(null)
  const [slotMinTime, setSlotMinTime] = useState("10:00:00")
  const [slotMaxTime, setSlotMaxTime] = useState("19:00:00")
  const [moveCopyPopup, setMoveCopyPopup] = useState<MoveCopyPopupState>(null)
  const [adminMoveConfirm, setAdminMoveConfirm] = useState<AdminMoveConfirmState>(null)
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
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
  const touchTapTargetRef = useRef<TouchTapTarget | null>(null)
  const lastTapDraftRef = useRef<{ date: string; time: string; createdAt: number } | null>(null)
  const fullCalendarViewMountedRef = useRef(false)
  const fullCalendarEventsSettledRef = useRef(false)
  const fullCalendarReadyFrameRef = useRef<number | null>(null)
  const fetchedRef = useRef<CachedRange[]>(
    initialRange
      ? [{
          teamId: null,
          startMs: toTime(initialRange.start),
          endMs: toTime(initialRange.end),
          data: { busy: initialBusy, bookings: initialBookings },
        }]
      : [],
  )
  const lastEmittedCodeRef = useRef<string | null>(null)

  const initialDrafts = useMemo<DraftEvent[]>(() => {
    return initialSlots.map((slot) => ({ id: makeDraftId(), start: slot.start, end: slot.end }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [drafts, setDrafts] = useState<DraftEvent[]>(initialDrafts)
  const [activeDraftId, setActiveDraftId] = useState<string | null>(initialDrafts[0]?.id ?? null)
  const [draftPreview, setDraftPreview] = useState<DraftEvent | null>(null)

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
  const visibleViewOptions = useMemo(
    () => isMobileCalendar ? VIEW_OPTIONS.filter((option) => option.value !== "timeGridWeek") : VIEW_OPTIONS,
    [isMobileCalendar],
  )

  const markFullCalendarReadyIfSettled = useCallback(() => {
    if (
      isFullCalendarReady ||
      selectedViewRef.current !== "dayGridMonth" ||
      !fullCalendarViewMountedRef.current ||
      !fullCalendarEventsSettledRef.current
    ) {
      return
    }
    if (fullCalendarReadyFrameRef.current !== null) return
    fullCalendarReadyFrameRef.current = window.requestAnimationFrame(() => {
      fullCalendarReadyFrameRef.current = null
      setIsFullCalendarReady(true)
    })
  }, [isFullCalendarReady])

  useEffect(() => {
    return () => {
      if (fullCalendarReadyFrameRef.current !== null) {
        window.cancelAnimationFrame(fullCalendarReadyFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_CALENDAR_MEDIA_QUERY)
    const syncMobileCalendar = () => setIsMobileCalendar(mediaQuery.matches)

    syncMobileCalendar()
    mediaQuery.addEventListener("change", syncMobileCalendar)
    return () => mediaQuery.removeEventListener("change", syncMobileCalendar)
  }, [])

  useEffect(() => {
    let frame: number | null = null
    if (view !== "dayGridMonth") {
      frame = window.requestAnimationFrame(() => {
        setIsMonthSkeletonMounted(false)
        setIsMonthSkeletonFading(false)
      })
      return () => {
        if (frame !== null) window.cancelAnimationFrame(frame)
      }
    }
    if (!isFullCalendarReady && monthSkeleton) {
      frame = window.requestAnimationFrame(() => {
        setIsMonthSkeletonMounted(true)
        setIsMonthSkeletonFading(false)
      })
    }
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [isFullCalendarReady, monthSkeleton, view])

  useEffect(() => {
    if (!isFullCalendarReady || !isMonthSkeletonMounted) return
    let timeout: number | null = null
    const frame = window.requestAnimationFrame(() => {
      setIsMonthSkeletonFading(true)
      timeout = window.setTimeout(() => {
        setIsMonthSkeletonMounted(false)
      }, 150)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (timeout !== null) window.clearTimeout(timeout)
    }
  }, [isFullCalendarReady, isMonthSkeletonMounted])

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
    }
  }, [])

  useEffect(() => {
    if (isMobileCalendar && view === "timeGridWeek") {
      const frame = window.requestAnimationFrame(() => changeCalendarView("timeGridDay"))
      return () => window.cancelAnimationFrame(frame)
    }
    return undefined
  }, [changeCalendarView, isMobileCalendar, view])

  const getReservationTimeRangeSlots = useCallback((extraSlots: { start: string; end: string }[] = []) => {
    const remoteBookings = fetchedRef.current.flatMap((entry) =>
      (entry.data.bookings ?? []).map((booking) => ({
        start: new Date(new Date(booking.start).getTime() - toBufferMs(booking.bufferBeforeHours)).toISOString(),
        end: new Date(new Date(booking.end).getTime() + toBufferMs(booking.bufferAfterHours)).toISOString(),
      })),
    )
    const remoteBusy = fetchedRef.current.flatMap((entry) =>
      (entry.data.busy ?? [])
        .filter((slot) => !isFullDayBusySlot(slot))
        .map((slot) => {
          const { before, after } = resolveBusyBufferHours(slot)
          return {
            start: new Date(new Date(slot.start).getTime() - toBufferMs(before)).toISOString(),
            end: new Date(new Date(slot.end).getTime() + toBufferMs(after)).toISOString(),
          }
        }),
    )
    const focusedSlots = focusSlot ? [{ start: focusSlot.start, end: focusSlot.end }] : []
    return [...drafts, ...remoteBookings, ...remoteBusy, ...focusedSlots, ...extraSlots]
  }, [drafts, focusSlot])

  const applyDynamicTimeRangeBounds = useCallback((extraSlots: { start: string; end: string }[] = []) => {
    const calendarApi = calendarRef.current?.getApi()
    const view = calendarApi?.view
    const visibleRange = view?.activeStart && view?.activeEnd ? { start: view.activeStart, end: view.activeEnd } : undefined
    const bounds = recomputeTimeRangeBounds(getReservationTimeRangeSlots(extraSlots), visibleRange)
    setSlotMinTime(bounds.slotMinTime)
    setSlotMaxTime(bounds.slotMaxTime)
  }, [getReservationTimeRangeSlots])

  const refreshRemoteEventsFromCache = useCallback(() => {
    calendarRef.current?.getApi().getEventSourceById("remote-events")?.refetch()
  }, [])

  const getCachedBooking = useCallback((bookingId: string): BookingFromApi | null => {
    for (const range of fetchedRef.current) {
      const booking = range.data.bookings?.find((item) => item.id === bookingId)
      if (booking) return booking
    }
    return null
  }, [])

  const patchCachedBooking = useCallback((
    bookingId: string,
    patches: Partial<Pick<BookingFromApi, "start" | "end" | "bufferBeforeHours" | "bufferAfterHours">>,
  ): boolean => {
    let changed = false
    fetchedRef.current = fetchedRef.current.map((range) => {
      const bookings = range.data.bookings
      if (!bookings?.some((booking) => booking.id === bookingId)) return range
      changed = true
      return {
        ...range,
        data: {
          ...range.data,
          bookings: bookings.map((booking) => (
            booking.id === bookingId ? { ...booking, ...patches } : booking
          )),
        },
      }
    })
    if (changed) {
      refreshRemoteEventsFromCache()
      applyDynamicTimeRangeBounds()
    }
    return changed
  }, [applyDynamicTimeRangeBounds, refreshRemoteEventsFromCache])

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
        changeCalendarView(getSelectionView(isMobileCalendar), firstSlot.start)
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
        changeCalendarView(getSelectionView(isMobileCalendar))
      }
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [adjustRequestKey, changeCalendarView, drafts, focusSlot, initialSlots, isMobileCalendar])

  const fetchEvents = useCallback(async (arg: EventSourceFuncArg): Promise<EventInput[]> => {
    const startMs = arg.start.getTime()
    const endMs = arg.end.getTime()
    const teamRanges = fetchedRef.current.filter((range) => range.teamId === selectedTeamId)
    const rangesToFetch = missingRanges(startMs, endMs, teamRanges)
    for (const range of rangesToFetch) {
      const data = await fetchFreeBusy(
        new Date(range.startMs).toISOString(),
        new Date(range.endMs).toISOString(),
        selectedTeamId,
      )
      fetchedRef.current.push({
        teamId: selectedTeamId,
        startMs: range.startMs,
        endMs: range.endMs,
        data,
      })
    }
    const data = mergeResponses(
      fetchedRef.current
        .filter((range) => range.teamId === selectedTeamId && range.startMs < endMs && range.endMs > startMs)
        .map((range) => range.data),
      startMs,
      endMs,
    )
    const nextCode = data.code ?? null
    if (lastEmittedCodeRef.current !== nextCode) {
      lastEmittedCodeRef.current = nextCode
      onCodeChange?.(nextCode)
    }
    const busyEvents = (data.busy ?? []).map((slot) => toBusyEvent(slot, isCalendarAdmin))
    const bookingEvents = (data.bookings ?? []).map((booking) =>
      toBookingEvent(
        booking,
        modeKind === "adjust" && booking.bookingGroupId === adjustingGroupId,
        viewerUserId,
        isCalendarAdmin,
        teamMemberUserIds,
      ),
    )
    const bufferEvents: EventInput[] = []
    if (isCalendarAdmin) {
      for (const slot of data.busy ?? []) {
        if (isFullDayBusySlot(slot)) continue
        const { before, after } = resolveBusyBufferHours(slot)
        const startMs = new Date(slot.start).getTime()
        const endMs = new Date(slot.end).getTime()
        bufferEvents.push({
          id: `busy-buffer-before-${slot.start}-${slot.end}`,
          title: `予定前 ${before} 時間は保護領域`,
          start: new Date(startMs - toBufferMs(before)).toISOString(),
          end: slot.start,
          display: "background",
          classNames: ["booking-calendar__confirmed-buffer"],
          editable: false,
          startEditable: false,
          durationEditable: false,
          extendedProps: { kind: "buffer", canEdit: true },
        })
        bufferEvents.push({
          id: `busy-buffer-after-${slot.start}-${slot.end}`,
          title: `予定後 ${after} 時間は保護領域`,
          start: slot.end,
          end: new Date(endMs + toBufferMs(after)).toISOString(),
          display: "background",
          classNames: ["booking-calendar__confirmed-buffer"],
          editable: false,
          startEditable: false,
          durationEditable: false,
          extendedProps: { kind: "buffer", canEdit: true },
        })
      }
    }
    for (const booking of data.bookings ?? []) {
      if (booking.status !== "CONFIRMED") continue
      const startMs = new Date(booking.start).getTime()
      const endMs = new Date(booking.end).getTime()
      const beforeHours = booking.bufferBeforeHours
      const afterHours = booking.bufferAfterHours
      const beforeProps: BufferEventProps = {
        kind: "buffer",
        side: "before",
        bookingId: booking.id,
        bookingGroupId: booking.bookingGroupId,
        bookingStart: booking.start,
        bookingEnd: booking.end,
        canEdit: isCalendarAdmin,
      }
      const afterProps: BufferEventProps = {
        kind: "buffer",
        side: "after",
        bookingId: booking.id,
        bookingGroupId: booking.bookingGroupId,
        bookingStart: booking.start,
        bookingEnd: booking.end,
        canEdit: isCalendarAdmin,
      }
      bufferEvents.push({
        id: `buffer-before-${booking.id}`,
        title: `本予約前 ${beforeHours} 時間は保護領域`,
        start: new Date(startMs - toBufferMs(beforeHours)).toISOString(),
        end: booking.start,
        ...(isCalendarAdmin ? {} : { display: "background" as const }),
        classNames: ["booking-calendar__confirmed-buffer", "booking-calendar__confirmed-buffer--before"],
        editable: isCalendarAdmin,
        startEditable: isCalendarAdmin,
        durationEditable: isCalendarAdmin,
        extendedProps: beforeProps,
      })
      bufferEvents.push({
        id: `buffer-after-${booking.id}`,
        title: `本予約後 ${afterHours} 時間は保護領域`,
        start: booking.end,
        end: new Date(endMs + toBufferMs(afterHours)).toISOString(),
        ...(isCalendarAdmin ? {} : { display: "background" as const }),
        classNames: ["booking-calendar__confirmed-buffer", "booking-calendar__confirmed-buffer--after"],
        editable: isCalendarAdmin,
        startEditable: false,
        durationEditable: isCalendarAdmin,
        extendedProps: afterProps,
      })
    }
    fullCalendarEventsSettledRef.current = true
    markFullCalendarReadyIfSettled()
    return [...busyEvents, ...bookingEvents, ...bufferEvents]
  }, [
    adjustingGroupId,
    isCalendarAdmin,
    markFullCalendarReadyIfSettled,
    modeKind,
    onCodeChange,
    selectedTeamId,
    teamMemberUserIds,
    viewerUserId,
  ])

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
    setActionError(null)
    refetchDraftEvents()
  }, [refetchDraftEvents, resetRequestKey, setDraftPreviewValue])

  const overlapsBlockedEvent = useCallback((start: Date, end: Date, excludeBookingId?: string): boolean => {
    for (const data of fetchedRef.current.values()) {
      for (const slot of data.data.busy ?? []) {
        if (rangesOverlap(start, end, slot.start, slot.end)) return true
      }
      for (const booking of data.data.bookings ?? []) {
        if (booking.id === excludeBookingId) continue
        if (rangesOverlap(start, end, booking.start, booking.end)) return true
      }
    }
    return false
  }, [])

  const overlapsConfirmedBufferZone = useCallback((start: Date, end: Date, excludeBookingId?: string): boolean => {
    for (const data of fetchedRef.current.values()) {
      for (const slot of data.data.busy ?? []) {
        const { before, after } = resolveBusyBufferHours(slot)
        const bufferStart = new Date(new Date(slot.start).getTime() - toBufferMs(before)).toISOString()
        const bufferEnd = new Date(new Date(slot.end).getTime() + toBufferMs(after)).toISOString()
        if (rangesOverlap(start, end, bufferStart, bufferEnd)) return true
      }
      for (const booking of data.data.bookings ?? []) {
        if (booking.id === excludeBookingId) continue
        if (booking.status !== "CONFIRMED") continue
        const bufferStart = new Date(new Date(booking.start).getTime() - toBufferMs(booking.bufferBeforeHours)).toISOString()
        const bufferEnd = new Date(new Date(booking.end).getTime() + toBufferMs(booking.bufferAfterHours)).toISOString()
        if (rangesOverlap(start, end, bufferStart, bufferEnd)) return true
      }
    }
    return false
  }, [])

  useEffect(() => {
    refetchRemoteEvents()
  }, [adjustingGroupId, modeKind, refetchRemoteEvents, selectedTeamId])

  useEffect(() => {
    if (remoteRefreshRequestKey === 0) return
    refetchRemoteEvents()
  }, [refetchRemoteEvents, remoteRefreshRequestKey])

  const cancelActiveDraft = useCallback(() => {
    if (!activeDraftId) return
    removeDraft(activeDraftId)
  }, [activeDraftId, removeDraft])

  const updateActionPanelPosition = useCallback(() => {
    if (!activeDraftId || !isSelectableView(view)) {
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
    if (!activeDraftId || !isSelectableView(view)) {
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
    if (!activePanelDraft || !isSelectableView(view) || !actionPanelPosition || !actionPanelRef.current) return
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

  const getTouchTapTarget = useCallback((target: EventTarget | null, clientX: number, clientY: number): TouchTapTarget | null => {
    if (selectedViewRef.current !== "timeGridDay") return null
    const element = target instanceof Element ? target : null
    if (!element) return null
    if (element.closest(".fc-event, button, a, input, textarea, select")) return null

    const root = rootRef.current
    const slot =
      element.closest<HTMLElement>(".fc-timegrid-slot-lane[data-time], .fc-timegrid-slot[data-time]") ??
      [...(root?.querySelectorAll<HTMLElement>(".fc-timegrid-slot-lane[data-time]") ?? [])].find((candidate) => {
        const rect = candidate.getBoundingClientRect()
        return clientY >= rect.top && clientY <= rect.bottom
      })
    const dayColumn =
      [...(root?.querySelectorAll<HTMLElement>(".fc-timegrid-col[data-date]") ?? [])].find((candidate) => {
        const rect = candidate.getBoundingClientRect()
        return clientX >= rect.left && clientX <= rect.right
      }) ?? root?.querySelector<HTMLElement>(".fc-timegrid-col[data-date]")
    const date = dayColumn?.dataset.date
    const time = slot?.dataset.time
    if (!date || !time) return null

    return { date, time, x: clientX, y: clientY }
  }, [])

  const handleCalendarPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return
    touchTapTargetRef.current = getTouchTapTarget(event.target, event.clientX, event.clientY)
  }, [getTouchTapTarget])

  const handleCalendarTouchStartCapture = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.changedTouches[0]
    if (!touch) return
    touchTapTargetRef.current = getTouchTapTarget(event.target, touch.clientX, touch.clientY)
  }, [getTouchTapTarget])

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

  const createDraftFromRange = useCallback((start: Date, end: Date) => {
    const calendarApi = calendarRef.current?.getApi()
    if (
      !hasMinimumSelectionDuration(start, end) ||
      overlapsBlockedEvent(start, end) ||
      overlapsConfirmedBufferZone(start, end)
    ) {
      finishInteraction()
      calendarApi?.unselect()
      return false
    }
    const draft: DraftEvent = {
      id: makeDraftId(),
      start: start.toISOString(),
      end: end.toISOString(),
    }
    finishInteraction([{ start: draft.start, end: draft.end }])
    upsertDraft(draft, true)
    calendarApi?.unselect()
    return true
  }, [finishInteraction, overlapsBlockedEvent, overlapsConfirmedBufferZone, upsertDraft])

  const handleSelect = useCallback((arg: DateSelectArg) => {
    if (!isSelectableView(arg.view.type)) {
      finishInteraction()
      calendarRef.current?.getApi().unselect()
      return
    }
    createDraftFromRange(arg.start, arg.end)
  }, [createDraftFromRange, finishInteraction])

  const createDraftFromTapTarget = useCallback((target: TouchTapTarget) => {
    const recent = lastTapDraftRef.current
    if (recent && recent.date === target.date && recent.time === target.time && Date.now() - recent.createdAt < 500) {
      return false
    }
    const start = parseDateTimeSlot(target.date, target.time)
    if (!start) return false
    const created = createDraftFromRange(start, new Date(start.getTime() + MIN_SELECTION_MS))
    if (created) {
      lastTapDraftRef.current = { date: target.date, time: target.time, createdAt: Date.now() }
    }
    return created
  }, [createDraftFromRange])

  const handleCalendarPointerUpCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return
    const startTarget = touchTapTargetRef.current
    touchTapTargetRef.current = null
    if (!startTarget) return

    const endTarget = getTouchTapTarget(event.target, event.clientX, event.clientY)
    if (!endTarget || endTarget.date !== startTarget.date || endTarget.time !== startTarget.time) return
    if (Math.hypot(event.clientX - startTarget.x, event.clientY - startTarget.y) > 10) return

    if (createDraftFromTapTarget(endTarget)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }, [createDraftFromTapTarget, getTouchTapTarget])

  const handleCalendarTouchEndCapture = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const startTarget = touchTapTargetRef.current
    touchTapTargetRef.current = null
    if (!startTarget) return

    const touch = event.changedTouches[0]
    if (!touch) return
    const endTarget = getTouchTapTarget(event.target, touch.clientX, touch.clientY)
    if (!endTarget || endTarget.date !== startTarget.date || endTarget.time !== startTarget.time) return
    if (Math.hypot(touch.clientX - startTarget.x, touch.clientY - startTarget.y) > 10) return

    if (createDraftFromTapTarget(endTarget)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }, [createDraftFromTapTarget, getTouchTapTarget])

  const handleCalendarClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const tapTarget = getTouchTapTarget(event.target, event.clientX, event.clientY)
    if (!tapTarget) return
    if (createDraftFromTapTarget(tapTarget)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }, [createDraftFromTapTarget, getTouchTapTarget])

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
    if (props?.kind === "buffer") return shouldAllowBufferEdge(props, span, isCalendarAdmin)
    if (props?.status === "CONFIRMED" && !isCalendarAdmin) return false
    const allowed =
      !overlapsBlockedEvent(span.start, span.end, props?.bookingId) &&
      !overlapsConfirmedBufferZone(span.start, span.end, props?.bookingId)
    if (allowed && props?.kind === "draft" && props.draftId) {
      const preview = {
        id: props.draftId,
        start: span.start.toISOString(),
        end: span.end.toISOString(),
      }
      setDraftPreviewValue({
        id: preview.id,
        start: preview.start,
        end: preview.end,
      })
      setActiveDraftId(props.draftId)
      if (interactionTypeRef.current === "resize") {
        applyDynamicTimeRangeBounds([{ start: preview.start, end: preview.end }])
      }
    }
    return allowed
  }, [applyDynamicTimeRangeBounds, isCalendarAdmin, overlapsBlockedEvent, overlapsConfirmedBufferZone, setDraftPreviewValue])

  const handleDateClick = useCallback(
    (arg: DateClickArg) => {
      if (arg.view.type === "dayGridMonth") {
        changeCalendarView(getSelectionView(isMobileCalendar), arg.dateStr)
        return
      }
      if (arg.view.type === "timeGridDay") {
        createDraftFromRange(arg.date, new Date(arg.date.getTime() + MIN_SELECTION_MS))
      }
    },
    [changeCalendarView, createDraftFromRange, isMobileCalendar],
  )

  const handleLogoutConfirm = useCallback(async () => {
    setIsLoggingOut(true)
    await signOut({ callbackUrl: "/" })
  }, [])

  const handleEventClick = useCallback((arg: EventClickArg) => {
    const props = arg.event.extendedProps as AnyEventProps
    if (props.kind === "draft" && props.draftId) {
      setActiveDraftId(props.draftId)
      setActionError(null)
      return
    }
    if (props.kind === "busy" && props.bookingId && props.canView) {
      if (modeKind === "adjust" && props.bookingGroupId === adjustingGroupId) return
      window.location.href = `/booking/${props.bookingId}`
    }
  }, [adjustingGroupId, modeKind])

  const moveBookingImmediately = useCallback((bookingId: string, start: string, end: string, revert: () => void) => {
    const previous = getCachedBooking(bookingId)
    patchCachedBooking(bookingId, { start, end })
    void (async () => {
      try {
        const response = await fetch(`/api/booking/${bookingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "move",
            start,
            end,
          }),
        })
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string }
          setActionError(mapErrorCodeToJa(payload.error ?? "unknown"))
          if (previous) patchCachedBooking(bookingId, { start: previous.start, end: previous.end })
          revert()
          return
        }
      } catch {
        setActionError(mapErrorCodeToJa("unknown"))
        if (previous) patchCachedBooking(bookingId, { start: previous.start, end: previous.end })
        revert()
      }
    })()
  }, [getCachedBooking, patchCachedBooking])

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
        if (shouldConfirmAdminMove(props, viewerUserId, isCalendarAdmin)) {
          arg.revert()
          const bookingGroupId = props.bookingGroupId
          const projectTitle = props.projectTitle
          if (!bookingGroupId || !projectTitle) return
          setAdminMoveConfirm({
            bookingId: props.bookingId,
            bookingGroupId,
            projectTitle,
            oldStart: arg.oldEvent.start?.toISOString() ?? props.label ?? "",
            oldEnd: arg.oldEvent.end?.toISOString() ?? "",
            newStart: newStart.toISOString(),
            newEnd: newEnd.toISOString(),
          })
          return
        }
        if (isCalendarAdmin && props.status === "CONFIRMED") {
          moveBookingImmediately(props.bookingId, newStart.toISOString(), newEnd.toISOString(), () => arg.revert())
          return
        }
        arg.revert()
        if (modeKind !== "adjust" || props.bookingGroupId !== adjustingGroupId) return
        setMoveCopyPopup({
          bookingId: props.bookingId,
          oldStart: arg.oldEvent.start?.toISOString() ?? "",
          oldEnd: arg.oldEvent.end?.toISOString() ?? "",
          start: newStart.toISOString(),
          end: newEnd.toISOString(),
          x: arg.jsEvent.clientX,
          y: arg.jsEvent.clientY,
        })
        return
      }

      arg.revert()
    },
    [adjustingGroupId, isCalendarAdmin, modeKind, moveBookingImmediately, overlapsBlockedEvent, overlapsConfirmedBufferZone, setDraftPreviewValue, updateDraftRange, viewerUserId],
  )

  const handleEventResize = useCallback((arg: EventResizeDoneArg) => {
    const props = arg.event.extendedProps as AnyEventProps
    const newStart = arg.event.start
    const newEnd = arg.event.end
    if (!newStart || !newEnd) {
      arg.revert()
      return
    }
    if (props.kind === "buffer") {
      if (!isCalendarAdmin || !props.bookingId || !props.side || !props.bookingStart || !props.bookingEnd) {
        arg.revert()
        return
      }
      const rawHours = props.side === "before"
        ? (new Date(props.bookingStart).getTime() - newStart.getTime()) / (60 * 60 * 1000)
        : (newEnd.getTime() - new Date(props.bookingEnd).getTime()) / (60 * 60 * 1000)
      const hours = Math.max(0, Math.round(rawHours * 2) / 2)
      const previous = getCachedBooking(props.bookingId)
      patchCachedBooking(
        props.bookingId,
        props.side === "before" ? { bufferBeforeHours: hours } : { bufferAfterHours: hours },
      )
      void (async () => {
        try {
          const response = await fetch(`/api/booking/${props.bookingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "resize_buffer",
              side: props.side,
              hours,
            }),
          })
          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as { error?: string }
            setActionError(mapErrorCodeToJa(payload.error ?? "unknown"))
            if (previous) {
              patchCachedBooking(props.bookingId!, {
                bufferBeforeHours: previous.bufferBeforeHours,
                bufferAfterHours: previous.bufferAfterHours,
              })
            }
            arg.revert()
            return
          }
        } catch {
          setActionError(mapErrorCodeToJa("unknown"))
          if (previous) {
            patchCachedBooking(props.bookingId!, {
              bufferBeforeHours: previous.bufferBeforeHours,
              bufferAfterHours: previous.bufferAfterHours,
            })
          }
          arg.revert()
        }
      })()
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
    if (props.kind === "busy" && props.bookingId && isCalendarAdmin && props.status === "CONFIRMED") {
      if (shouldConfirmAdminMove(props, viewerUserId, isCalendarAdmin)) {
        arg.revert()
        setAdminMoveConfirm({
          bookingId: props.bookingId,
          bookingGroupId: props.bookingGroupId!,
          projectTitle: props.projectTitle!,
          oldStart: arg.oldEvent.start?.toISOString() ?? "",
          oldEnd: arg.oldEvent.end?.toISOString() ?? "",
          newStart: newStart.toISOString(),
          newEnd: newEnd.toISOString(),
        })
        return
      }
      moveBookingImmediately(props.bookingId, newStart.toISOString(), newEnd.toISOString(), () => arg.revert())
      return
    }
    arg.revert()
  }, [getCachedBooking, isCalendarAdmin, moveBookingImmediately, overlapsBlockedEvent, overlapsConfirmedBufferZone, patchCachedBooking, setDraftPreviewValue, updateDraftRange, viewerUserId])

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

  const renderDayCellContent = (arg: DayCellContentArg) => {
    if (arg.view.type !== "dayGridMonth") return undefined
    return <span>{arg.date.getDate()}</span>
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
      if (props.draftId === activeDraftId && isSelectableView(arg.view.type)) {
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
      const statusLabel = props.status === "CONFIRMED" ? "本予約" : "予約不可"
      const shortLabel = props.status === "CONFIRMED" ? "本" : "不"
      const rangeLabel = props.label ?? (arg.event.start && arg.event.end ? `${format(arg.event.start, "HH:mm")}-${format(arg.event.end, "HH:mm")}` : "")
      const monthTimeLabel = arg.event.allDay ? "終日" : arg.event.start ? format(arg.event.start, "HH:mm") : rangeLabel
      const title = props.projectTitle?.trim()
      const canShowTitle = props.status === "CONFIRMED" && props.canView && title
      const baseText = canShowTitle
        ? isMonthView
          ? `${monthTimeLabel} 本: ${title}`
          : `本予約 ${rangeLabel}: ${title}`
        : props.status === "CONFIRMED" && !props.canView
          ? "本予約"
          : isMonthView
            ? `${monthTimeLabel} ${shortLabel}`
            : `${statusLabel} ${rangeLabel}`.trim()
      const text = !canShowTitle && !props.bookingId && title
        ? `${baseText}: ${title}`
        : baseText
      return (
        <span className="booking-calendar__busy-pill-content">
          {!props.canEdit && lockIcon}
          <span className="booking-calendar__booking-label">{text}</span>
        </span>
      )
    }
    return undefined
  }

  const runPreflight = useCallback(
    async (slot: { start: string; end: string }): Promise<BookingConflictsResponse> => {
      const response = await fetch("/api/booking/conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
    async () => {
      if (!activeDraft || preflighting) return
      const slots = drafts.length > 0 ? drafts.map((draft) => ({ start: draft.start, end: draft.end })) : [{ start: activeDraft.start, end: activeDraft.end }]
      const slot = { start: activeDraft.start, end: activeDraft.end }
      setPreflighting(true)
      setActionError(null)
      try {
        const verdict = await runPreflight(slot)
        setActionPanelPosition(null)
        if (verdict.verdict === "block") {
          setActionError(verdict.message)
          return
        }
        onCommit(slots)
      } catch (error) {
        const message = error instanceof Error ? error.message : "予約の重なり確認に失敗しました"
        setActionError(message)
      } finally {
        setPreflighting(false)
      }
    },
    [activeDraft, drafts, onCommit, preflighting, runPreflight],
  )

  const executeMove = useCallback(
    async () => {
      if (!moveCopyPopup) return
      patchCachedBooking(moveCopyPopup.bookingId, { start: moveCopyPopup.start, end: moveCopyPopup.end })
      try {
        const response = await fetch(`/api/booking/${moveCopyPopup.bookingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "move",
            start: moveCopyPopup.start,
            end: moveCopyPopup.end,
          }),
        })
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string }
          setActionError(mapErrorCodeToJa(payload.error ?? "unknown"))
          patchCachedBooking(moveCopyPopup.bookingId, { start: moveCopyPopup.oldStart, end: moveCopyPopup.oldEnd })
          return
        }
        setMoveCopyPopup(null)
      } catch {
        setActionError(mapErrorCodeToJa("unknown"))
        patchCachedBooking(moveCopyPopup.bookingId, { start: moveCopyPopup.oldStart, end: moveCopyPopup.oldEnd })
      }
    },
    [moveCopyPopup, patchCachedBooking],
  )

  const executeAdminMove = useCallback(
    async () => {
      if (!adminMoveConfirm) return
      patchCachedBooking(adminMoveConfirm.bookingId, {
        start: adminMoveConfirm.newStart,
        end: adminMoveConfirm.newEnd,
      })
      try {
        const response = await fetch(`/api/booking/${adminMoveConfirm.bookingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "move",
            start: adminMoveConfirm.newStart,
            end: adminMoveConfirm.newEnd,
          }),
        })
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string }
          setActionError(mapErrorCodeToJa(payload.error ?? "unknown"))
          patchCachedBooking(adminMoveConfirm.bookingId, {
            start: adminMoveConfirm.oldStart,
            end: adminMoveConfirm.oldEnd,
          })
          setAdminMoveConfirm(null)
          return
        }
        setAdminMoveConfirm(null)
      } catch {
        setActionError(mapErrorCodeToJa("unknown"))
        patchCachedBooking(adminMoveConfirm.bookingId, {
          start: adminMoveConfirm.oldStart,
          end: adminMoveConfirm.oldEnd,
        })
        setAdminMoveConfirm(null)
      }
    },
    [adminMoveConfirm, patchCachedBooking],
  )

  const handleFullCalendarViewDidMount = useCallback(() => {
    fullCalendarViewMountedRef.current = true
    markFullCalendarReadyIfSettled()
  }, [markFullCalendarReadyIfSettled])

  const handleFullCalendarLoading = useCallback((isLoading: boolean) => {
    if (isLoading) return
    fullCalendarEventsSettledRef.current = true
    markFullCalendarReadyIfSettled()
  }, [markFullCalendarReadyIfSettled])

  const hideFullCalendarForMonthSkeleton = view === "dayGridMonth" && !isFullCalendarReady && Boolean(monthSkeleton)

  return (
    <div
      className="booking-calendar"
      ref={rootRef}
      onMouseDownCapture={handleCalendarMouseDownCapture}
      onMouseMoveCapture={handleCalendarMouseMoveCapture}
      onClickCapture={handleCalendarClickCapture}
      onPointerDownCapture={handleCalendarPointerDownCapture}
      onPointerUpCapture={handleCalendarPointerUpCapture}
      onTouchStartCapture={handleCalendarTouchStartCapture}
      onTouchEndCapture={handleCalendarTouchEndCapture}
    >
      <div className="booking-calendar__view-row">
        <div className="booking-calendar__tabs" aria-label="カレンダー表示切替">
          {visibleViewOptions.map((option) => {
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
        <div className="booking-calendar__view-row-end">
          {modeKind === "adjust" ? (
            <div className="booking-calendar__adjust-badge glass-inset">
              {(adjustingTitle ?? projectTitle)?.trim() ? `${(adjustingTitle ?? projectTitle)!.trim()}案件の日時調整中` : "日時調整中"}
            </div>
          ) : null}
          {onSelectedTeamIdChange ? (
            <div className="booking-calendar__scope">
              <label className="booking-calendar__scope-label" htmlFor="booking-team-scope">
                <span className="booking-calendar__scope-label-full">ログイン状態</span>
                <span className="booking-calendar__scope-label-compact">ログイン状態</span>
              </label>
              <select
                id="booking-team-scope"
                className="booking-calendar__scope-select glass-input"
                value={selectedTeamId ?? ""}
                onChange={(event) => {
                  onSelectedTeamIdChange(event.target.value || null)
                }}
              >
                <option value="">{viewerEmail || "個人"}</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="booking-calendar__logout-button"
                onClick={() => setIsLogoutConfirmOpen(true)}
              >
                ログアウト
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {isLogoutConfirmOpen ? (
        <div
          className="booking-calendar__modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="booking-logout-title"
        >
          <div className="booking-calendar__modal-card glass-flat">
            <h2 id="booking-logout-title" className="booking-calendar__modal-title">
              ログアウトしますか？
            </h2>
            <p className="booking-calendar__modal-message">
              予約カレンダーを使うには再ログインが必要になります。
            </p>
            <div className="booking-calendar__modal-actions">
              <button
                type="button"
                className="booking-calendar__action-button"
                onClick={() => setIsLogoutConfirmOpen(false)}
                disabled={isLoggingOut}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="booking-calendar__action-button booking-calendar__action-button--primary"
                onClick={handleLogoutConfirm}
                disabled={isLoggingOut}
              >
                {isLoggingOut ? "ログアウト中..." : "ログアウト"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {activePanelDraft && isSelectableView(view) && actionPanelPosition ? (
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
              onClick={() => startCommit()}
              disabled={preflighting}
            >
              {preflighting ? "確認中…" : "本予約"}
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
        <div className="booking-calendar__stack">
          {isMonthSkeletonMounted ? (
            <div
              className={`booking-calendar__month-skeleton-layer ${isMonthSkeletonFading ? "booking-calendar__month-skeleton-layer--fading" : ""}`}
            >
              {monthSkeleton}
            </div>
          ) : null}
          <div className={`booking-calendar__fullcalendar-layer ${hideFullCalendarForMonthSkeleton ? "booking-calendar__fullcalendar-layer--hidden" : ""}`}>
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
              selectable={isSelectableView(view)}
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
              lazyFetching
              loading={handleFullCalendarLoading}
              datesSet={() => applyDynamicTimeRangeBounds()}
              viewDidMount={handleFullCalendarViewDidMount}
              eventContent={renderEventContent}
              eventDidMount={handleEventDidMount}
              dayCellClassNames={dayCellClassNames}
              dayCellContent={renderDayCellContent}
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
        </div>
      </div>
      {adminMoveConfirm ? (
        <div
          className="booking-calendar__modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="booking-admin-move-confirm-title"
        >
          <div className="booking-calendar__modal-card glass-flat">
            <h2
              id="booking-admin-move-confirm-title"
              className="booking-calendar__modal-title"
            >
              お客様の予約時間を変更しますか？
            </h2>
            <p className="booking-calendar__modal-message">
              案件名：{adminMoveConfirm.projectTitle}
            </p>
            <p className="booking-calendar__modal-message">
              変更前：{formatRange(adminMoveConfirm.oldStart, adminMoveConfirm.oldEnd)}
            </p>
            <p className="booking-calendar__modal-message">
              変更後：{formatRange(adminMoveConfirm.newStart, adminMoveConfirm.newEnd)}
            </p>
            <div className="booking-calendar__modal-actions">
              <button
                type="button"
                className="booking-calendar__action-button"
                onClick={() => setAdminMoveConfirm(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="booking-calendar__action-button booking-calendar__action-button--primary"
                onClick={() => void executeAdminMove()}
              >
                変更を確定
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {moveCopyPopup ? (
        <div
          className="booking-calendar__move-copy-popup glass-flat"
          role="dialog"
          aria-modal="false"
          style={{ left: moveCopyPopup.x, top: moveCopyPopup.y }}
        >
          <button type="button" className="booking-calendar__action-button" onClick={() => void executeMove()}>
            Move
          </button>
          <button type="button" className="booking-calendar__action-button booking-calendar__action-button--ghost" onClick={() => setMoveCopyPopup(null)}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  )
}
