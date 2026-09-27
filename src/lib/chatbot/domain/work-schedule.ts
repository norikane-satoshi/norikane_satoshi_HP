import type { WorkflowEstimate } from "./workflow-estimate"

export type WorkScheduleRole = "prep" | "attendance" | "finish"

export type WorkScheduleDay = { date: string; role: WorkScheduleRole }

export type WorkSchedulePlan = {
  days: WorkScheduleDay[]
  /** Owner work days that found no free day before the first or after the last attendance day. */
  shortfall?: { prep: number; finish: number }
}

export const workScheduleRoleLabels: Record<WorkScheduleRole, string> = {
  prep: "コンフォーム・仕込み（則兼の作業日）",
  attendance: "立ち会い",
  finish: "QC（則兼の作業日）",
}

const SEARCH_LIMIT_DAYS = 60

/**
 * How many calendar days each part of the job holds. The owner's conform and preparation come
 * before the attendance and the check after it; a half-day attendance leaves the rest of its day
 * for a half-day conform, so a CM is one day in all.
 */
export function workScheduleDayCounts(estimate: Pick<WorkflowEstimate, "stages" | "attendanceDays">): {
  prepDays: number
  attendanceDays: { min: number; max: number }
  finishDays: number
} {
  const stage = (name: string) => estimate.stages.find((item) => item.stage === name)
  const attended = stage("attended")
  const ownBefore = (stage("conform")?.maxDays ?? 0) + (stage("prep")?.maxDays ?? 0)
  const attendanceMax = estimate.attendanceDays ?? attended?.maxDays ?? 1
  const sharedWithAttendance = attendanceMax < 1 ? 1 - attendanceMax : 0
  const attendanceDays = estimate.attendanceDays !== undefined
    ? { min: Math.max(1, Math.ceil(estimate.attendanceDays)), max: Math.max(1, Math.ceil(estimate.attendanceDays)) }
    : {
        min: Math.max(1, Math.ceil(attended?.minDays ?? 1)),
        max: Math.max(1, Math.floor(attended?.maxDays ?? 1)),
      }
  return {
    prepDays: wholeDays(ownBefore - sharedWithAttendance),
    attendanceDays: { min: Math.min(attendanceDays.min, attendanceDays.max), max: attendanceDays.max },
    finishDays: wholeDays(stage("final-check")?.maxDays ?? 0),
  }
}

/**
 * The customer picks the attendance days; the owner's days are placed on the nearest free days
 * before the first attendance day (not today or earlier) and after the last one.
 */
export function planWorkSchedule(input: {
  attendanceDates: readonly string[]
  estimate: Pick<WorkflowEstimate, "stages" | "attendanceDays">
  isFree: (date: string) => boolean
  today: string
}): WorkSchedulePlan {
  const attendance = [...new Set(input.attendanceDates)].sort()
  if (attendance.length === 0) return { days: [] }
  const counts = workScheduleDayCounts(input.estimate)
  const taken = new Set(attendance)
  const pick = (from: string, step: 1 | -1, count: number) => {
    const picked: string[] = []
    let cursor = from
    for (let i = 0; i < SEARCH_LIMIT_DAYS && picked.length < count; i += 1) {
      cursor = shiftDate(cursor, step)
      if (step < 0 && cursor <= input.today) break
      if (taken.has(cursor) || !input.isFree(cursor)) continue
      picked.push(cursor)
    }
    return picked
  }
  const prep = pick(attendance[0], -1, counts.prepDays)
  const finish = pick(attendance[attendance.length - 1], 1, counts.finishDays)
  const days: WorkScheduleDay[] = [
    ...prep.map((date) => ({ date, role: "prep" as const })),
    ...attendance.map((date) => ({ date, role: "attendance" as const })),
    ...finish.map((date) => ({ date, role: "finish" as const })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const shortfall = { prep: counts.prepDays - prep.length, finish: counts.finishDays - finish.length }
  return { days, ...(shortfall.prep > 0 || shortfall.finish > 0 ? { shortfall } : {}) }
}

/** "立ち会い: 10/6(月)、10/7(火)" per role, in job order. */
export function describeWorkSchedule(plan: WorkSchedulePlan): string[] {
  const roles: WorkScheduleRole[] = ["prep", "attendance", "finish"]
  return roles.flatMap((role) => {
    const dates = plan.days.filter((day) => day.role === role).map((day) => formatScheduleDate(day.date))
    return dates.length > 0 ? [`${workScheduleRoleLabels[role]}: ${dates.join("、")}`] : []
  })
}

function wholeDays(value: number): number {
  return Math.max(0, Math.ceil(value - 1e-9))
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

const weekdays = ["日", "月", "火", "水", "木", "金", "土"]

function formatScheduleDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  const weekday = weekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  return `${month}/${day}(${weekday})`
}
