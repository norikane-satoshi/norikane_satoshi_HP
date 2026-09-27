import {
  describeWorkSchedule,
  planWorkSchedule,
  workScheduleRoleLabels,
  type JobContext,
  type WorkflowEstimate,
  type WorkSchedulePlan,
} from "@/lib/chatbot/domain"
import { findCandidateCalendar } from "@/lib/chatbot/server/availability-finder"

const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
// Owner work days are searched this far past the last attendance day.
const PLAN_REACH_DAYS = 60

export type ChatbotWorkSchedule = WorkSchedulePlan & {
  lines: string[]
  dateLabels: Record<string, string>
}

/**
 * Places the owner's conform, preparation and check days around the attendance days the customer
 * chose, on days the owner's calendar has free, and names each date for the tentative hold.
 */
export async function planChatbotWorkSchedule(input: {
  jobContext: JobContext
  workflowEstimate: WorkflowEstimate
  attendanceDates: string[]
  now?: Date
  candidateCalendarFinder?: typeof findCandidateCalendar
}): Promise<ChatbotWorkSchedule> {
  const now = input.now ?? new Date()
  const today = jstDateKey(now)
  const lastAttendance = [...input.attendanceDates].sort().at(-1) ?? today
  const reachDays = Math.max(0, (Date.parse(`${lastAttendance}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS)
  const calendar = await (input.candidateCalendarFinder ?? findCandidateCalendar)({
    jobContext: input.jobContext,
    workflowEstimate: input.workflowEstimate,
    notBefore: today,
    now,
    lookaheadWeeks: Math.ceil((reachDays + PLAN_REACH_DAYS) / 7) + 1,
    candidateLimit: 1000,
    busyMode: "block",
  })
  const free = new Set(calendar.candidates.map((candidate) => jstDateKey(new Date(candidate.start))))
  const plan = planWorkSchedule({
    attendanceDates: input.attendanceDates,
    estimate: input.workflowEstimate,
    isFree: (date) => free.has(date),
    today,
  })
  return {
    ...plan,
    lines: [
      ...describeWorkSchedule(plan),
      ...(plan.shortfall ? [describeShortfall(plan.shortfall)] : []),
    ],
    dateLabels: Object.fromEntries(
      plan.days.map((day) => [day.date, day.role === "attendance" ? "立ち会い" : day.role === "prep" ? "仕込み" : "QC"]),
    ),
  }
}

function describeShortfall(shortfall: NonNullable<WorkSchedulePlan["shortfall"]>): string {
  const parts = [
    shortfall.prep > 0 ? `${workScheduleRoleLabels.prep}があと${shortfall.prep}日` : undefined,
    shortfall.finish > 0 ? `${workScheduleRoleLabels.finish}があと${shortfall.finish}日` : undefined,
  ].filter(Boolean)
  return `空きが足りません: ${parts.join("、")}必要です（則兼が日程を相談します）`
}

function jstDateKey(value: Date): string {
  return new Date(value.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)
}
