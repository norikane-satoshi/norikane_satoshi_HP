import type { CandidateWindow, JobContext, WorkflowEstimate, WorkSite } from "@/lib/chatbot/domain"

export const STUDIO_ACTIVE_FROM = "2026-10-01T00:00:00+09:00"

const DEFAULT_LOOKAHEAD_WEEKS = 8
const CANDIDATE_LIMIT = 3
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const VALID_WORK_SITES = new Set<WorkSite>(["satoshi-studio", "remote-grading", "on-site"])
export type FreeBusyFetcher = (args: {
  from: string
  to: string
}) => Promise<Array<{ start: string; end: string }>>

export type AttendanceConflictResolver = (args: {
  from: string
  to: string
}) => Promise<Array<{ start: string; end: string; bookingId: string }>>

export type ChatbotAvailabilityErrorKind =
  | "studio-not-yet-active"
  | "work-site-unspecified"
  | "free-busy-fetch-failed"
  | "attendance-resolver-failed"

export class ChatbotAvailabilityError extends Error {
  kind: ChatbotAvailabilityErrorKind

  constructor(kind: ChatbotAvailabilityErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "ChatbotAvailabilityError"
    this.kind = kind
  }
}

type CandidateSearchArgs = {
  jobContext: JobContext
  workflowEstimate: WorkflowEstimate
  desiredDeadline?: string
  notBefore?: string
  lookaheadWeeks?: number
  candidateLimit?: number
  busyMode?: "score" | "block"
  now?: Date
  freeBusyFetcher?: FreeBusyFetcher
  attendanceConflictResolver?: AttendanceConflictResolver
}

export type CandidateCalendarResult = {
  candidates: CandidateWindow[]
  busyDateKeys: string[]
}

export async function findCandidateWindows(args: CandidateSearchArgs): Promise<CandidateWindow[]> {
  const result = await findCandidateCalendar(args)
  return result.candidates
}

export async function findCandidateCalendar(args: CandidateSearchArgs): Promise<CandidateCalendarResult> {
  const now = args.now ?? new Date()
  assertWorkSite(args.jobContext.workSite, now)

  const lookaheadWeeks = args.lookaheadWeeks ?? DEFAULT_LOOKAHEAD_WEEKS
  const searchFrom = maxDate(startOfJstDay(now), args.notBefore ? parseStartDate(args.notBefore) : null)
  const searchTo = new Date(now.getTime() + lookaheadWeeks * 7 * DAY_MS)
  const deadline = args.desiredDeadline ? parseDeadline(args.desiredDeadline) : null
  const neededBusinessDays = Math.max(1, Math.ceil(args.workflowEstimate.totalMinDays))
  const fetcher = args.freeBusyFetcher ?? defaultFreeBusyFetcher
  const resolver = args.attendanceConflictResolver ?? defaultAttendanceConflictResolver

  const [busyIntervals, attendanceIntervals] = await Promise.all([
    runFreeBusyFetcher(fetcher, searchFrom, searchTo),
    runAttendanceResolver(resolver, searchFrom, searchTo),
  ])

  const normalizedBusyIntervals = busyIntervals.map(normalizeInterval).filter(isValidInterval)
  const candidates = buildCandidateWindows({
    searchFrom,
    searchTo,
    neededBusinessDays,
    deadline,
    busyMode: args.busyMode ?? "score",
    busyIntervals: normalizedBusyIntervals,
    attendanceIntervals: attendanceIntervals.map(normalizeInterval).filter(isValidInterval),
  })

  return {
    candidates: candidates
      .sort((a, b) => b.score - a.score || a.start.getTime() - b.start.getTime())
      .slice(0, args.candidateLimit ?? CANDIDATE_LIMIT)
      .map((candidate) => ({
        start: candidate.start.toISOString(),
        end: candidate.end.toISOString(),
        label: `${formatJstDate(candidate.start)} 単日`,
        available: true,
        note: [
          `businessDays=${neededBusinessDays}`,
          `busyRatio=${candidate.busyRatio.toFixed(2)}`,
          deadline ? `deadlineSlackDays=${candidate.deadlineSlackDays.toFixed(1)}` : null,
          "attendanceConflicts=0",
        ].filter(Boolean).join("; "),
      })),
    busyDateKeys: busyDateKeysFromIntervals(normalizedBusyIntervals, searchFrom, searchTo),
  }
}

async function defaultFreeBusyFetcher(args: {
  from: string
  to: string
}): Promise<Array<{ start: string; end: string }>> {
  const { getNotionWorkScheduleBusyIntervals } = await import("@/lib/chatbot/server/notion-work-schedule-busy")
  return getNotionWorkScheduleBusyIntervals(args)
}

async function defaultAttendanceConflictResolver(args: {
  from: string
  to: string
}): Promise<Array<{ start: string; end: string; bookingId: string }>> {
  void args
  return []
}

async function runFreeBusyFetcher(
  fetcher: FreeBusyFetcher,
  from: Date,
  to: Date,
): Promise<Array<{ start: string; end: string }>> {
  try {
    return await fetcher({ from: from.toISOString(), to: to.toISOString() })
  } catch (error) {
    if (error instanceof ChatbotAvailabilityError) throw error
    throw new ChatbotAvailabilityError(
      "free-busy-fetch-failed",
      "Failed to fetch chatbot busy intervals.",
      { cause: error },
    )
  }
}

async function runAttendanceResolver(
  resolver: AttendanceConflictResolver,
  from: Date,
  to: Date,
): Promise<Array<{ start: string; end: string; bookingId: string }>> {
  try {
    return await resolver({ from: from.toISOString(), to: to.toISOString() })
  } catch (error) {
    if (error instanceof ChatbotAvailabilityError) throw error
    throw new ChatbotAvailabilityError(
      "attendance-resolver-failed",
      "Failed to resolve attended booking intervals.",
      { cause: error },
    )
  }
}

function assertWorkSite(workSite: JobContext["workSite"], now: Date): asserts workSite is WorkSite {
  if (!workSite || !VALID_WORK_SITES.has(workSite)) {
    throw new ChatbotAvailabilityError(
      "work-site-unspecified",
      "Work site must be specified before finding candidate windows.",
    )
  }

  if (workSite === "satoshi-studio" && now.getTime() < new Date(STUDIO_ACTIVE_FROM).getTime()) {
    throw new ChatbotAvailabilityError(
      "studio-not-yet-active",
      "Satoshi studio is not active before 2026-10-01 JST.",
    )
  }
}

function parseDeadline(value: string): Date {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59.999+09:00`)
    : new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    throw new ChatbotAvailabilityError(
      "work-site-unspecified",
      "desiredDeadline must be an ISO 8601 string or ISO date string.",
    )
  }

  return parsed
}

function parseStartDate(value: string): Date {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000+09:00`)
    : new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    throw new ChatbotAvailabilityError(
      "work-site-unspecified",
      "notBefore must be an ISO 8601 string or ISO date string.",
    )
  }

  return startOfJstDay(parsed)
}

type Interval = {
  start: Date
  end: Date
}

type ScoredCandidate = Interval & {
  score: number
  busyRatio: number
  deadlineSlackDays: number
}

function buildCandidateWindows(args: {
  searchFrom: Date
  searchTo: Date
  neededBusinessDays: number
  deadline: Date | null
  busyMode: "score" | "block"
  busyIntervals: Interval[]
  attendanceIntervals: Interval[]
}): ScoredCandidate[] {
  const candidates: ScoredCandidate[] = []
  for (
    let cursor = args.searchFrom;
    cursor.getTime() < args.searchTo.getTime();
    cursor = addJstDays(cursor, 1)
  ) {
    if (!isBusinessDay(cursor)) continue

    const window = createDayWindow(cursor)
    if (window.end.getTime() > args.searchTo.getTime()) continue
    if (args.deadline && window.end.getTime() > args.deadline.getTime()) continue
    if (args.attendanceIntervals.some((interval) => overlaps(window, interval))) continue
    if (args.busyMode === "block" && args.busyIntervals.some((interval) => overlaps(window, interval))) continue

    const busyMs = args.busyIntervals.reduce((sum, interval) => sum + overlapMs(window, interval), 0)
    const durationMs = window.end.getTime() - window.start.getTime()
    const busyRatio = durationMs > 0 ? Math.min(1, busyMs / durationMs) : 1
    const deadlineSlackDays = args.deadline
      ? Math.max(0, (args.deadline.getTime() - window.end.getTime()) / DAY_MS)
      : 0

    candidates.push({
      ...window,
      busyRatio,
      deadlineSlackDays,
      score: scoreWindow({
        window,
        searchFrom: args.searchFrom,
        searchTo: args.searchTo,
        busyRatio,
        deadline: args.deadline,
        deadlineSlackDays,
      }),
    })
  }

  return candidates
}

function createDayWindow(start: Date): Interval {
  return {
    start,
    end: addJstDays(start, 1),
  }
}

function scoreWindow(args: {
  window: Interval
  searchFrom: Date
  searchTo: Date
  busyRatio: number
  deadline: Date | null
  deadlineSlackDays: number
}): number {
  const searchRangeMs = Math.max(1, args.searchTo.getTime() - args.searchFrom.getTime())
  const earliness = 1 - Math.max(0, args.window.start.getTime() - args.searchFrom.getTime()) / searchRangeMs
  const emptiness = 1 - args.busyRatio
  const slack = args.deadline
    ? Math.min(1, args.deadlineSlackDays / Math.max(1, (args.deadline.getTime() - args.searchFrom.getTime()) / DAY_MS))
    : 0

  return earliness * 0.55 + emptiness * 0.35 + slack * 0.1
}

function normalizeInterval(input: { start: string; end: string }): Interval {
  return {
    start: new Date(input.start),
    end: new Date(input.end),
  }
}

function isValidInterval(interval: Interval): boolean {
  return (
    !Number.isNaN(interval.start.getTime()) &&
    !Number.isNaN(interval.end.getTime()) &&
    interval.start.getTime() < interval.end.getTime()
  )
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && a.end.getTime() > b.start.getTime()
}

function busyDateKeysFromIntervals(intervals: Interval[], from: Date, to: Date): string[] {
  const keys = new Set<string>()

  for (const interval of intervals) {
    const firstDay = startOfJstDay(maxDate(interval.start, from))
    for (
      let cursor = firstDay;
      cursor.getTime() < interval.end.getTime() && cursor.getTime() < to.getTime();
      cursor = addJstDays(cursor, 1)
    ) {
      const day = { start: cursor, end: addJstDays(cursor, 1) }
      if (overlaps(day, interval) && overlaps(day, { start: from, end: to })) {
        keys.add(formatJstDate(cursor))
      }
    }
  }

  return [...keys].sort()
}

function overlapMs(a: Interval, b: Interval): number {
  if (!overlaps(a, b)) return 0
  return Math.max(0, Math.min(a.end.getTime(), b.end.getTime()) - Math.max(a.start.getTime(), b.start.getTime()))
}

function isBusinessDay(date: Date): boolean {
  const day = getJstDay(date)
  return day !== 0 && day !== 6
}

function startOfJstDay(date: Date): Date {
  const parts = getJstDateParts(date)
  return jstDate(parts.year, parts.month, parts.day)
}

function maxDate(a: Date, b: Date | null): Date {
  if (!b) return a
  return a.getTime() >= b.getTime() ? a : b
}

function addJstDays(date: Date, days: number): Date {
  const parts = getJstDateParts(date)
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days) - JST_OFFSET_MS)
}

function jstDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - JST_OFFSET_MS)
}

function getJstDay(date: Date): number {
  return new Date(date.getTime() + JST_OFFSET_MS).getUTCDay()
}

function getJstDateParts(date: Date): { year: number; month: number; day: number } {
  const jstDateValue = new Date(date.getTime() + JST_OFFSET_MS)
  return {
    year: jstDateValue.getUTCFullYear(),
    month: jstDateValue.getUTCMonth() + 1,
    day: jstDateValue.getUTCDate(),
  }
}

function formatJstDate(date: Date): string {
  const parts = getJstDateParts(date)
  return [
    String(parts.year),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-")
}
