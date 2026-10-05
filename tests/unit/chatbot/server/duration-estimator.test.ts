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
    ["ドラマシリーズです", { jobKind: "drama-first" }],
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

  it("does not treat a job-kind choice label as final-medium confirmation", () => {
    expect(
      inferWorkflowJobContextFromText(
        "選択: ライブ / コンサート / 舞台収録",
        jobContext({ jobKind: "live-60m", finalMedium: "other" }),
      ),
    ).toEqual({})
  })

  it("estimates CM 30s without additional work at satoshi-studio", () => {
    const result = estimateWorkflow(jobContext({ projectLengthMinutes: 0.5 }))

    expect(result.totalMinDays).toBe(1)
    expect(result.totalMaxDays).toBe(1)
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

    expect(result.totalMinDays).toBeCloseTo(2.928571428571429)
    expect(result.totalMaxDays).toBeCloseTo(2.928571428571429)
    expect(result.note).toBe("案件ごと上乗せ議論")
  })

  it("adds skin retouch days, and one QC day once the customer names an NHK or OTT delivery", () => {
    const base = {
      jobKind: "feature-90m" as const,
      finalMedium: "ott" as const,
      projectLengthMinutes: 90,
      additionalWork: ["skin-retouch" as const],
      retouchCutCount: 200,
    }
    const unnamed = estimateWorkflow(jobContext(base))
    const named = estimateWorkflow(jobContext({ ...base, strictDeliveryClient: true }))

    expect([unnamed.totalMinDays, unnamed.totalMaxDays].map((value) => Number(value.toFixed(3)))).toEqual([8.857, 10.857])
    expect(unnamed.riskFlags).not.toContain("strict-delivery")
    expect([named.totalMinDays, named.totalMaxDays].map((value) => Number(value.toFixed(3)))).toEqual([9.857, 11.857])
    expect(named.riskFlags).toContain("strict-delivery")
  })

  it.each(["cinema", "tv-broadcast", "ott"] as const)(
    "keeps one QC day for a %s delivery until the customer names a strict one",
    (finalMedium) => {
      const result = estimateWorkflow(jobContext({ jobKind: "feature-90m", projectLengthMinutes: 90, finalMedium }))

      expect(result.stages.find((stage) => stage.stage === "final-check")).toEqual({
        stage: "final-check",
        minDays: 1,
        maxDays: 1,
      })
      expect([result.totalMinDays, result.totalMaxDays]).toEqual([6, 8])
    },
  )

  it.each([
    ["NHKの特集ドラマです", true],
    ["Netflix で配信予定です", true],
    ["ディズニープラスのオリジナル作品です", true],
    ["Amazon Prime Video 向けです", true],
    ["OTT 案件です", true],
    ["YouTube で配信します", false],
    ["劇場公開予定です", false],
  ])("notices a strict delivery only when the customer names one: %s", (message, strict) => {
    const inferred = inferWorkflowJobContextFromText(message, jobContext({ jobKind: "feature-90m" }))

    expect(Boolean(inferred.strictDeliveryClient)).toBe(strict)
  })

  it("flags heavy retouch for drama first episode without adding days", () => {
    const result = estimateWorkflow(
      jobContext({
        jobKind: "drama-first",
        projectLengthMinutes: 45,
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

  it("does not count travel to a room away from the studio, and marks final check skip", () => {
    const result = estimateWorkflow(
      jobContext({
        jobKind: "live-60m",
        finalMedium: "live",
        workSite: "on-site",
        projectLengthMinutes: 60,
      }),
    )

    expect(result.totalMinDays).toBe(4)
    expect(result.totalMaxDays).toBe(4)
    expect(result.stages.find((stage) => stage.stage === "prep")).toMatchObject({ minDays: 2, maxDays: 2 })
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

    // The total is the sum of the eased stages (conform 1, prep 4〜4.5, attendance 1, QC 1).
    expect(result.totalMinDays).toBe(7)
    expect(result.totalMaxDays).toBe(7.5)
  })

  it.each([
    [90, 6, 8, undefined],
    [135, 7, 9.5, "90分/180分アンカー間の緩やかな目安"],
    [180, 7, 10, undefined],
    [240, 7, 10.5, "3時間超は素材量・チェック体制の確認優先"],
    [60, 6, 8, "尺が基準と異なるため要相談"],
  ])("grows a feature's days with its length from the 90-minute and 3-hour lines: %s min", (minutes, min, max, note) => {
    const result = estimateWorkflow(jobContext({ jobKind: "feature-90m", projectLengthMinutes: minutes }))

    expect([result.totalMinDays, result.totalMaxDays]).toEqual([min, max])
    expect(result.note).toBe(note)
    expect(result.estimateStatus).toBe("authoritative")
  })

  it.each([
    ["drama-first", 5, 1, 2, "短尺ドラマ（1話あたり）の目安"],
    ["drama-follow-up", 14, 1, 2, "短尺ドラマ（1話あたり）の目安"],
    ["drama-first", 45, 6, 7, undefined],
    ["drama-follow-up", 50, 5, 5, undefined],
    ["drama-first", 30, 6, 7, "尺が基準（1話45〜50分）と異なるため要相談"],
  ] as const)("estimates a %s episode of %s min from its length", (jobKind, minutes, min, max, note) => {
    const result = estimateWorkflow(jobContext({ jobKind, projectLengthMinutes: minutes }))

    expect([result.totalMinDays, result.totalMaxDays]).toEqual([min, max])
    expect(result.note).toBe(note)
  })

  it("uses the synced lines, and the built-in line for one an older snapshot lacks", () => {
    const presets = [
      {
        id: "feature-90m",
        label: "本編 90分",
        minDays: 7,
        maxDays: 9,
        stages: {
          conform: { minDays: 1, maxDays: 1 },
          prep: { minDays: 4, maxDays: 4 },
          attendance: { minDays: 1, maxDays: 3 },
          finish: { minDays: 1, maxDays: 1 },
        },
        source: "notion-sync" as const,
      },
    ]
    const knowledgeSnapshot = {
      version: 1 as const,
      manifestPageId: "manifest",
      syncedAt: "2026-09-27T00:00:00.000Z",
      entries: [],
      workflowDurations: { presets },
      noteKnowledge: [],
    }

    const at90 = estimateWorkflow(jobContext({ jobKind: "feature-90m", projectLengthMinutes: 90 }), { knowledgeSnapshot })
    const at180 = estimateWorkflow(jobContext({ jobKind: "feature-90m", projectLengthMinutes: 180 }), { knowledgeSnapshot })

    expect([at90.totalMinDays, at90.totalMaxDays]).toEqual([7, 9])
    expect([at180.totalMinDays, at180.totalMaxDays]).toEqual([7, 10])
  })

  it("splits a job into the stages the owner quotes, leaving the attendance range open", () => {
    const result = estimateWorkflow(jobContext({ jobKind: "feature-90m", projectLengthMinutes: 90 }))

    expect(result.stages).toEqual([
      { stage: "conform", minDays: 1, maxDays: 1 },
      { stage: "prep", minDays: 3, maxDays: 3 },
      { stage: "attended", minDays: 1, maxDays: 3 },
      { stage: "final-check", minDays: 1, maxDays: 1 },
    ])
    expect([result.totalMinDays, result.totalMaxDays]).toEqual([6, 8])
    expect(result.attendanceDays).toBeUndefined()
  })

  it.each([
    [1, 6],
    [2, 7],
    [3, 8],
  ])("fixes the total once the customer chooses %s attendance days", (attendanceDays, total) => {
    const result = estimateWorkflow(jobContext({ jobKind: "feature-90m", projectLengthMinutes: 90, attendanceDays }))

    expect([result.totalMinDays, result.totalMaxDays]).toEqual([total, total])
    expect(result.attendanceDays).toBe(attendanceDays)
    expect(result.stages.find((stage) => stage.stage === "attended")).toEqual({
      stage: "attended",
      minDays: attendanceDays,
      maxDays: attendanceDays,
    })
  })

  it("puts added work on its stage: attached videos in preparation, a strict delivery's extra day in the check", () => {
    const result = estimateWorkflow(
      jobContext({
        jobKind: "feature-90m",
        projectLengthMinutes: 90,
        finalMedium: "ott",
        strictDeliveryClient: true,
        documentaryAttachment: { kind: "making", count: 2 },
        attendanceDays: 2,
      }),
    )

    expect(result.stages).toEqual([
      { stage: "conform", minDays: 1, maxDays: 1 },
      { stage: "prep", minDays: 3.5, maxDays: 3.5 },
      { stage: "attended", minDays: 2, maxDays: 2 },
      { stage: "final-check", minDays: 2, maxDays: 2, note: "納品先の検査に合わせて1日多め" },
    ])
    expect([result.totalMinDays, result.totalMaxDays]).toEqual([8.5, 8.5])
  })

  it("ignores an attendance count outside the job's range", () => {
    const result = estimateWorkflow(jobContext({ jobKind: "feature-90m", projectLengthMinutes: 90, attendanceDays: 5 }))

    expect(result.attendanceDays).toBeUndefined()
    expect([result.totalMinDays, result.totalMaxDays]).toEqual([6, 8])
  })

  it("keeps half-day stages for a CM", () => {
    const result = estimateWorkflow(jobContext({ projectLengthMinutes: 0.5 }))

    expect(result.stages).toEqual([
      { stage: "conform", minDays: 0.5, maxDays: 0.5 },
      { stage: "prep", minDays: 0, maxDays: 0 },
      { stage: "attended", minDays: 0.5, maxDays: 0.5 },
      { stage: "final-check", minDays: 0, maxDays: 0 },
    ])
  })

  it("eases each stage between the 90-minute and 3-hour lines", () => {
    const result = estimateWorkflow(jobContext({ jobKind: "feature-90m", projectLengthMinutes: 135, attendanceDays: 1 }))

    expect(result.stages.find((stage) => stage.stage === "prep")).toEqual({ stage: "prep", minDays: 4, maxDays: 4.5 })
    expect([result.totalMinDays, result.totalMaxDays]).toEqual([7, 7.5])
  })
})

