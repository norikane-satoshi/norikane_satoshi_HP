import { describe, expect, it } from "vitest"

import { describeWorkSchedule, planWorkSchedule, workScheduleDayCounts } from "@/lib/chatbot/domain"
import type { WorkflowEstimate } from "@/lib/chatbot/domain"

const feature90: Pick<WorkflowEstimate, "stages" | "attendanceDays"> = {
  stages: [
    { stage: "conform", minDays: 1, maxDays: 1 },
    { stage: "prep", minDays: 3, maxDays: 3 },
    { stage: "attended", minDays: 2, maxDays: 2 },
    { stage: "final-check", minDays: 1, maxDays: 1 },
  ],
  attendanceDays: 2,
}

const cm: Pick<WorkflowEstimate, "stages" | "attendanceDays"> = {
  stages: [
    { stage: "conform", minDays: 0.5, maxDays: 0.5 },
    { stage: "prep", minDays: 0, maxDays: 0 },
    { stage: "attended", minDays: 0.5, maxDays: 0.5 },
    { stage: "final-check", minDays: 0, maxDays: 0 },
  ],
}

const mv: Pick<WorkflowEstimate, "stages" | "attendanceDays"> = {
  stages: [
    { stage: "conform", minDays: 0.5, maxDays: 0.5 },
    { stage: "prep", minDays: 0, maxDays: 0 },
    { stage: "attended", minDays: 1, maxDays: 1 },
    { stage: "final-check", minDays: 0, maxDays: 0 },
  ],
}

describe("work schedule", () => {
  it("counts whole calendar days for each part of the job", () => {
    expect(workScheduleDayCounts(feature90)).toEqual({ prepDays: 4, attendanceDays: { min: 2, max: 2 }, finishDays: 1 })
    expect(workScheduleDayCounts({ ...feature90, attendanceDays: undefined, stages: feature90.stages.map((stage) =>
      stage.stage === "attended" ? { ...stage, minDays: 1, maxDays: 3 } : stage) })).toEqual({
      prepDays: 4,
      attendanceDays: { min: 1, max: 3 },
      finishDays: 1,
    })
    // A CM's half-day conform shares the day of its half-day attendance.
    expect(workScheduleDayCounts(cm)).toEqual({ prepDays: 0, attendanceDays: { min: 1, max: 1 }, finishDays: 0 })
    // An MV's half-day conform takes a day of its own before the full attendance day.
    expect(workScheduleDayCounts(mv)).toEqual({ prepDays: 1, attendanceDays: { min: 1, max: 1 }, finishDays: 0 })
  })

  it("places the owner's days on the nearest free days around the chosen attendance days", () => {
    const busy = new Set(["2026-10-11"])
    const plan = planWorkSchedule({
      attendanceDates: ["2026-10-14", "2026-10-13"],
      estimate: feature90,
      isFree: (date) => !busy.has(date),
      today: "2026-10-01",
    })

    expect(plan).toEqual({
      days: [
        { date: "2026-10-08", role: "prep" },
        { date: "2026-10-09", role: "prep" },
        { date: "2026-10-10", role: "prep" },
        { date: "2026-10-12", role: "prep" },
        { date: "2026-10-13", role: "attendance" },
        { date: "2026-10-14", role: "attendance" },
        { date: "2026-10-15", role: "finish" },
      ],
    })
    expect(describeWorkSchedule(plan)).toEqual([
      "コンフォーム・仕込み（則兼の作業日）: 10/8(木)、10/9(金)、10/10(土)、10/12(月)",
      "立ち会い: 10/13(火)、10/14(水)",
      "QC（則兼の作業日）: 10/15(木)",
    ])
  })

  it("reports the preparation days that do not fit before an attendance day too soon", () => {
    const plan = planWorkSchedule({
      attendanceDates: ["2026-10-04", "2026-10-05"],
      estimate: feature90,
      isFree: () => true,
      today: "2026-10-01",
    })

    expect(plan.days.filter((day) => day.role === "prep").map((day) => day.date)).toEqual(["2026-10-02", "2026-10-03"])
    expect(plan.shortfall).toEqual({ prep: 2, finish: 0 })
  })
})
