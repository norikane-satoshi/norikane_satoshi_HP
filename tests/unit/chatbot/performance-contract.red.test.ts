import { describe, expect, it } from "vitest"

import {
  calibrateChatbotPerformanceBaseline,
  evaluateChatbotPerformanceObservation,
  evaluateChatbotPerformanceScenarios,
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
        { totalServer: 54_000, contextPreparation: 53_000 },
        { totalServer: 52_000, contextPreparation: 51_000 },
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
        { totalServer: 50_000, contextPreparation: 48_000, conversationLoad: 10 },
        { totalServer: 51_000, contextPreparation: 49_000, conversationLoad: 12 },
        { totalServer: 52_000, contextPreparation: 50_000, conversationLoad: 11 },
        { totalServer: 53_000, contextPreparation: 51_000, conversationLoad: 13 },
        { totalServer: 54_000, contextPreparation: 52_000, conversationLoad: 14 },
      ],
    })

    expect(baseline.stages.totalServer).toMatchObject({ p50Ms: 52_000, p95Ms: 54_000 })
    expect(evaluateChatbotPerformanceObservation({
      baseline,
      stageTimings: { totalServer: 70_000, contextPreparation: 51_000, conversationLoad: 13 },
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
      samples: Array.from({ length: 5 }, () => ({ totalServer: 30_000, contextPreparation: 25_000 })),
    })

    expect(evaluateChatbotPerformanceWindow({
      baseline,
      samples: Array.from({ length: 5 }, () => ({ totalServer: 40_000, contextPreparation: 25_000 })),
    })).toEqual({
      status: "regressed",
      sampleCount: 5,
      violations: ["totalServer"],
      observedP95Ms: { contextPreparation: 25_000, totalServer: 40_000 },
    })
  })

  it("evaluates Tier 0 and Tier 2 samples against separate performance baselines", () => {
    const tier0Baseline = calibrateChatbotPerformanceBaseline({
      buildSha: "tier0-baseline",
      measuredAt: "2026-08-20T15:11:30.377Z",
      allowedRegressionRatio: 1.2,
      minimumHeadroomMs: 1000,
      samples: Array.from({ length: 5 }, () => ({ totalServer: 600, contextPreparation: 20 })),
    })
    const tier2Baseline = calibrateChatbotPerformanceBaseline({
      buildSha: "tier2-baseline",
      measuredAt: "2026-08-23T12:40:28.820Z",
      allowedRegressionRatio: 1.2,
      minimumHeadroomMs: 1000,
      samples: Array.from({ length: 5 }, () => ({ totalServer: 7_500, contextPreparation: 0 })),
    })

    expect(evaluateChatbotPerformanceScenarios({
      baselines: {
        "tier-0-deterministic-intake": tier0Baseline,
        "tier-2-gemini-flash": tier2Baseline,
      },
      samples: Array.from({ length: 5 }, () => ({
        tier: "tier-2-gemini-flash",
        stageTimings: { totalServer: 8_000, contextPreparation: 0 },
      })),
    })).toEqual({
      status: "within-budget",
      sampleCount: 5,
      violations: [],
      scenarios: {
        "tier-0-deterministic-intake": {
          status: "insufficient-data",
          sampleCount: 0,
          violations: ["sample-count"],
          observedP95Ms: {},
        },
        "tier-2-gemini-flash": {
          status: "within-budget",
          sampleCount: 5,
          violations: [],
          observedP95Ms: { contextPreparation: 0, totalServer: 8_000 },
        },
      },
    })
  })

  it("does not let fast Tier 0 samples hide a Tier 2 regression", () => {
    const baseline = calibrateChatbotPerformanceBaseline({
      buildSha: "baseline",
      measuredAt: "2026-08-20T15:11:30.377Z",
      allowedRegressionRatio: 1.2,
      minimumHeadroomMs: 1000,
      samples: Array.from({ length: 5 }, () => ({ totalServer: 10_000 })),
    })

    expect(evaluateChatbotPerformanceScenarios({
      baselines: {
        "tier-0-deterministic-intake": baseline,
        "tier-2-gemini-flash": baseline,
      },
      samples: [
        ...Array.from({ length: 5 }, () => ({
          tier: "tier-2-gemini-flash",
          stageTimings: { totalServer: 20_000 },
        })),
        ...Array.from({ length: 5 }, () => ({
          tier: "tier-0-deterministic-intake",
          stageTimings: { totalServer: 5_000 },
        })),
      ],
    })).toMatchObject({
      status: "regressed",
      sampleCount: 10,
      violations: ["tier-2-gemini-flash:totalServer"],
      scenarios: {
        "tier-0-deterministic-intake": { status: "within-budget" },
        "tier-2-gemini-flash": { status: "regressed" },
      },
    })
  })
})
