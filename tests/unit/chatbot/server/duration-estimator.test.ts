import { describe, expect, it } from "vitest"

import type { JobContext } from "@/lib/chatbot/domain"
import { estimateWorkflow } from "@/lib/chatbot/server/duration-estimator"

function jobContext(overrides: Partial<JobContext>): JobContext {
  return {
    jobKind: "cm-30s",
    finalMedium: "web",
    workSite: "satoshi-studio",
    documentaryAttachment: { kind: "none" },
    ...overrides,
  }
}

describe("chatbot duration estimator", () => {
  it("estimates CM 30s without additional work at satoshi-studio", () => {
    const result = estimateWorkflow(jobContext({ projectLengthMinutes: 0.5 }))

    expect(result.totalMinDays).toBe(1)
    expect(result.totalMaxDays).toBe(2)
    expect(result.riskFlags).toEqual([])
  })

  it("adds retouch days for MV remote-grading", () => {
    const result = estimateWorkflow(
      jobContext({
        jobKind: "mv-5m",
        projectLengthMinutes: 5,
        workSite: "remote-grading",
        additionalWork: ["retouch"],
        retouchCutCount: 100,
      }),
    )

    expect(result.totalMinDays).toBeCloseTo(3.428571428571429)
    expect(result.totalMaxDays).toBeCloseTo(3.928571428571429)
    expect(result.stages[0]?.note).toBe("案件ごと上乗せ議論")
  })

  it("adds strict medium and skin retouch days for feature OTT", () => {
    const result = estimateWorkflow(
      jobContext({
        jobKind: "feature-90m",
        finalMedium: "ott",
        projectLengthMinutes: 90,
        additionalWork: ["skin-retouch"],
        retouchCutCount: 200,
      }),
    )

    expect(result.totalMinDays).toBeCloseTo(13.857142857142858)
    expect(result.totalMaxDays).toBeCloseTo(14.857142857142858)
    expect(result.riskFlags).toContain("strict-delivery")
  })

  it("flags heavy retouch for drama first episode without adding days", () => {
    const result = estimateWorkflow(
      jobContext({
        jobKind: "drama-first",
        finalMedium: "tv-broadcast",
        heavyRetouch: true,
        additionalWork: ["retouch"],
      }),
    )

    expect(result.totalMinDays).toBe(6)
    expect(result.totalMaxDays).toBe(7)
    expect(result.riskFlags).toContain("heavy-retouch")
    expect(result.requiresDirectContact).toBe(true)
  })

  it("adds on-site travel range for live 60m and marks final check skip", () => {
    const result = estimateWorkflow(
      jobContext({
        jobKind: "live-60m",
        finalMedium: "live",
        workSite: "on-site",
        projectLengthMinutes: 60,
      }),
    )

    expect(result.totalMinDays).toBe(7.5)
    expect(result.totalMaxDays).toBe(9)
    expect(result.riskFlags).toContain("on-site-transfer")
  })

  it("does not scale date-granularity live work linearly by project length", () => {
    const result = estimateWorkflow(
      jobContext({
        jobKind: "live-60m",
        finalMedium: "live",
        workSite: "on-site",
        projectLengthMinutes: 150,
        additionalWork: ["retouch", "skin-retouch"],
        retouchCutCount: 70,
      }),
    )

    expect(result.totalMinDays).toBeCloseTo(8.5)
    expect(result.totalMaxDays).toBeCloseTo(10)
    expect(result.totalMinDays).toBeLessThan(17)
    expect(result.totalMaxDays).toBeLessThan(20)
  })

  it("keeps live 2.5h retouch and skin-retouch work in the 7-9 day band without 17-20 days", () => {
    const result = estimateWorkflow(
      jobContext({
        jobKind: "live-60m",
        finalMedium: "live",
        workSite: "remote-grading",
        projectLengthMinutes: 150,
        additionalWork: ["retouch", "skin-retouch"],
      }),
    )

    expect(result.totalMinDays).toBeGreaterThanOrEqual(7)
    expect(result.totalMaxDays).toBeLessThanOrEqual(9)
    expect(result.totalMinDays).toBeLessThan(17)
    expect(result.totalMaxDays).toBeLessThan(20)
  })
})
