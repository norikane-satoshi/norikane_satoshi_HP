import { expect, it, vi } from "vitest"
vi.mock("@/lib/chatbot/server/availability-finder", () => ({ findCandidateCalendar: vi.fn() }))
import { planChatbotWorkSchedule } from "../work-schedule-plan"
import type { WorkflowEstimate } from "@/lib/chatbot/domain"
const estimate: WorkflowEstimate = {
  stages: [{ stage: "attended", minDays: 1, maxDays: 1 }, { stage: "final-check", minDays: 1, maxDays: 1 }],
  attendanceDays: 1, totalMinDays: 2, totalMaxDays: 2, requiresDirectContact: false, riskFlags: [],
}
it("does not place QC after the deadline, reporting the shortfall instead", async () => {
  const candidateCalendarFinder = vi.fn().mockResolvedValue({ candidates: [
    { start: "2026-10-10T01:00:00Z" }, { start: "2026-10-11T01:00:00Z" },
  ] })
  const result = await planChatbotWorkSchedule({
    jobContext: { finalMedium: "web", workSite: "remote-grading", documentaryAttachment: { kind: "none" } }, workflowEstimate: estimate,
    attendanceDates: ["2026-10-10"], dueDate: "2026-10-10", now: new Date("2026-09-29T00:00:00Z"), candidateCalendarFinder,
  })
  expect(result.days).toEqual([{ date: "2026-10-10", role: "attendance" }])
  expect(result.shortfall).toEqual({ prep: 0, finish: 1 })
})
it("rejects attendance after the deadline before consulting a calendar", async () => {
  const candidateCalendarFinder = vi.fn()
  await expect(planChatbotWorkSchedule({
    jobContext: { finalMedium: "web", workSite: "remote-grading", documentaryAttachment: { kind: "none" } }, workflowEstimate: estimate,
    attendanceDates: ["2026-10-11"], dueDate: "2026-10-10", candidateCalendarFinder,
  })).rejects.toThrow("attendance_after_deadline")
  expect(candidateCalendarFinder).not.toHaveBeenCalled()
})
