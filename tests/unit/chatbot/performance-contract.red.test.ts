import { describe, expect, it } from "vitest"

import {
  calibrateChatbotPerformanceBaseline,
  evaluateChatbotPerformanceObservation,
  evaluateChatbotPerformanceWindow,
} from "@/lib/chatbot/audit/performance"

describe("chatbot performance contract", () => {
  it("refuses to invent a baseline from fewer than five live samples", () => {
    expect(() => calibrateChatbotPerformanceBaseline({
      buildSha: "abc123",
      measuredAt: "2026-08-20T00:00:00.000Z",
      allowedRegressionRatio: 1.2,
      minimumHeadroomMs: 250,
      samples: [
        { totalServer: 54_000, notionInference: 53_000 },
        { totalServer: 52_000, notionInference: 51_000 },
      ],
    })).toThrow("performance_baseline_requires_five_samples")
  })

  it("calibrates p50/p95 by stage and fails a later regression", () => {
    const baseline = calibrateChatbotPerformanceBaseline({
      buildSha: "abc123",
      measuredAt: "2026-08-20T00:00:00.000Z",
      allowedRegressionRatio: 1.2,
      minimumHeadroomMs: 250,
      samples: [
        { totalServer: 50_000, notionInference: 48_000, conversationLoad: 10 },
        { totalServer: 51_000, notionInference: 49_000, conversationLoad: 12 },
        { totalServer: 52_000, notionInference: 50_000, conversationLoad: 11 },
        { totalServer: 53_000, notionInference: 51_000, conversationLoad: 13 },
        { totalServer: 54_000, notionInference: 52_000, conversationLoad: 14 },
      ],
    })

    expect(baseline.stages.totalServer).toMatchObject({ p50Ms: 52_000, p95Ms: 54_000 })
    expect(evaluateChatbotPerformanceObservation({
      baseline,
      stageTimings: { totalServer: 70_000, notionInference: 51_000, conversationLoad: 13 },
    })).toEqual({
      status: "regressed",
      violations: ["totalServer"],
    })
  })

  it("reports unbaselined instead of silently passing without live evidence", () => {
    expect(evaluateChatbotPerformanceObservation({
      baseline: null,
      stageTimings: { totalServer: 54_000 },
    })).toEqual({ status: "unbaselined", violations: ["baseline-missing"] })
  })

  it("refuses to judge a performance window with fewer than five samples", () => {
    const baseline = calibrateChatbotPerformanceBaseline({
      buildSha: "baseline-sha",
      measuredAt: "2026-08-20T15:11:30.377Z",
      allowedRegressionRatio: 1.2,
      minimumHeadroomMs: 1000,
      samples: Array.from({ length: 5 }, () => ({ totalServer: 30_000 })),
    })

    expect(evaluateChatbotPerformanceWindow({
      baseline,
      samples: Array.from({ length: 4 }, () => ({ totalServer: 30_000 })),
    })).toEqual({
      status: "insufficient-data",
      sampleCount: 4,
      violations: ["sample-count"],
      observedP95Ms: {},
    })
  })

  it("detects a p95 regression across a five-sample monitoring window", () => {
    const baseline = calibrateChatbotPerformanceBaseline({
      buildSha: "baseline-sha",
      measuredAt: "2026-08-20T15:11:30.377Z",
      allowedRegressionRatio: 1.2,
      minimumHeadroomMs: 1000,
      samples: Array.from({ length: 5 }, () => ({ totalServer: 30_000, notionInference: 25_000 })),
    })

    expect(evaluateChatbotPerformanceWindow({
      baseline,
      samples: Array.from({ length: 5 }, () => ({ totalServer: 40_000, notionInference: 25_000 })),
    })).toEqual({
      status: "regressed",
      sampleCount: 5,
      violations: ["totalServer"],
      observedP95Ms: { notionInference: 25_000, totalServer: 40_000 },
    })
  })
})
