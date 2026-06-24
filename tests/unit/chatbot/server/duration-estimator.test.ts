import { describe, expect, it } from "vitest"

import type { JobContext } from "@/lib/chatbot/domain"
import { estimateWorkflow, inferWorkflowJobContextFromText } from "@/lib/chatbot/server/duration-estimator"

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
  it.each([
    ["Web CM 30秒です", { finalMedium: "web", jobKind: "cm-30s", projectLengthMinutes: 0.5 }],
    ["MV 5分の相談です", { jobKind: "mv-5m", projectLengthMinutes: 5 }],
    ["OTT向け本編90分です", { finalMedium: "ott", jobKind: "feature-90m", projectLengthMinutes: 90 }],
    ["ドラマ初回です", { jobKind: "drama-first" }],
    ["ドラマ2話目以降です", { jobKind: "drama-follow-up" }],
    ["縦型動画60秒です", { finalMedium: "vertical-sns", jobKind: "vertical-60s", projectLengthMinutes: 1 }],
    ["ライブ2時間半です。最終的にDVDにします", { finalMedium: "live", deliveryMedium: "dvd", jobKind: "live-60m", projectLengthMinutes: 150 }],
  ])("infers workflow facts from explicit free text: %s", (message, expected) => {
    expect(inferWorkflowJobContextFromText(message, jobContext({ jobKind: undefined, finalMedium: "other" }))).toMatchObject(expected)
  })

  it("does not overwrite already confirmed job facts from free text", () => {
    expect(
      inferWorkflowJobContextFromText(
        "Web CM 30秒です",
        jobContext({ jobKind: "mv-5m", finalMedium: "live", projectLengthMinutes: 5 }),
      ),
    ).toEqual({})
  })

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

    expect(result.totalMinDays).toBe(4.5)
    expect(result.totalMaxDays).toBe(5)
    expect(result.estimateStatus).toBe("authoritative")
    expect(result.riskFlags).toContain("on-site-transfer")
  })

  it("uses 150m live as an authoritative 7-8 day anchor", () => {
    const result = estimateWorkflow(
      jobContext({
        jobKind: "live-60m",
        finalMedium: "live",
        projectLengthMinutes: 150,
      }),
    )

    expect(result.totalMinDays).toBe(7)
    expect(result.totalMaxDays).toBe(8)
    expect(result).toMatchObject({
      estimateStatus: "authoritative",
    })
  })

  it("keeps live duration growth non-linear between 60m and 150m", () => {
    const result = estimateWorkflow(
      jobContext({
        jobKind: "live-60m",
        finalMedium: "live",
        projectLengthMinutes: 120,
      }),
    )

    expect(result.totalMinDays).toBe(6.5)
    expect(result.totalMaxDays).toBe(7.5)
  })
})
