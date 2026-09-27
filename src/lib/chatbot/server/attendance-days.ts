import type { JobContext, SurveyChoiceSet, WorkflowEstimate } from "@/lib/chatbot/domain"
import {
  describeJobForEstimate,
  describeWorkflowStages,
  formatDayRange,
} from "@/lib/chatbot/knowledge/workflow-duration"

export const attendanceDaysChoiceSetId = "attendance-days"

/** Whole attendance days the customer can choose; a job with one possible count has nothing to choose. */
export function attendanceDayOptions(estimate: WorkflowEstimate | undefined): number[] {
  const attended = estimate?.stages.find((stage) => stage.stage === "attended")
  if (!attended || estimate?.attendanceDays !== undefined) return []
  const options: number[] = []
  for (let days = Math.max(1, Math.ceil(attended.minDays)); days <= Math.floor(attended.maxDays); days += 1) {
    options.push(days)
  }
  return options.length >= 2 ? options : []
}

export function needsAttendanceDaysChoice(estimate: WorkflowEstimate | undefined): boolean {
  return attendanceDayOptions(estimate).length > 0
}

/**
 * The owner's own days (conform, preparation, check) are fixed by the job; the customer only picks
 * how many days to attend, and each option shows what the whole job then takes.
 */
export function buildAttendanceDaysChoices(jobContext: JobContext, estimate: WorkflowEstimate): SurveyChoiceSet {
  const ownStages = estimate.stages.filter((stage) => stage.stage !== "attended")
  const ownMin = ownStages.reduce((sum, stage) => sum + stage.minDays, 0)
  const ownMax = ownStages.reduce((sum, stage) => sum + stage.maxDays, 0)
  const breakdown = describeWorkflowStages(estimate.stages)
  const subject = jobContext.jobKind ? describeJobForEstimate(jobContext.jobKind, jobContext.projectLengthMinutes) : "この案件"
  return {
    id: attendanceDaysChoiceSetId,
    question: `${subject}は${breakdown ? `、${breakdown}` : ""}が目安です。立ち会いは何日にしますか？`,
    choices: [
      ...attendanceDayOptions(estimate).map((days) => ({
        id: String(days),
        label: `${days}日（全体で${formatDayRange(ownMin + days, ownMax + days)}）`,
      })),
      { id: "undecided", label: "未定・相談して決めたい" },
    ],
  }
}
