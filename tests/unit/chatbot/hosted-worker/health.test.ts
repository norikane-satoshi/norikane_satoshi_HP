import { describe, expect, it } from "vitest"

import {
  createHostedWorkerRuntimeState,
  getHostedWorkerQuickHealth,
  recordHostedWorkerGenerateFailure,
  recordHostedWorkerGenerateSuccess,
} from "@/lib/chatbot/hosted-worker/health"

describe("hosted worker health", () => {
  it("returns quick health without requiring a fresh CDP runtime inspection", () => {
    const state = createHostedWorkerRuntimeState()
    state.queue.inFlight = true
    state.queue.queueLength = 2

    const health = getHostedWorkerQuickHealth(state)

    expect(health).toMatchObject({
      ok: true,
      status: "ready",
      healthMode: "quick",
      tier: "tier-1-hosted-chrome-notion-ai",
      queue: {
        inFlight: true,
        queueLength: 2,
      },
    })
  })

  it("reuses the last deep ready health metadata for quick checks", () => {
    const state = createHostedWorkerRuntimeState()
    state.lastReadyHealth = {
      ok: true,
      status: "ready",
      action: "none",
      cdp: {
        baseUrl: "http://127.0.0.1:9223",
        reachable: true,
        browser: "Chrome/test",
      },
      notionTarget: {
        found: true,
        loginRedirect: false,
        targetUrlMatches: true,
        target: {
          id: "target_1",
          type: "page",
          title: "Notion AI",
          url: "https://www.notion.so/chat",
        },
      },
      notionAiModelSelection: {
        selectedModel: "diagnostic-model",
      },
      targetCount: 3,
      tier: "tier-1-hosted-chrome-notion-ai",
      queue: { inFlight: false, queueLength: 0 },
      runtime: { currentStatus: "ready", consecutiveFailures: 0 },
      healthMode: "deep",
      checkedAt: "2026-06-29T00:00:00.000Z",
    }

    expect(getHostedWorkerQuickHealth(state)).toMatchObject({
      ok: true,
      status: "ready",
      healthMode: "quick",
      cdp: { browser: "Chrome/test" },
      notionTarget: { found: true, targetUrlMatches: true },
      notionAiModelSelection: { selectedModel: "diagnostic-model" },
      targetCount: 3,
    })
  })

  it("separates current readiness from the last historical incident", () => {
    const state = createHostedWorkerRuntimeState()

    recordHostedWorkerGenerateFailure(state, {
      code: "rate-limit",
      at: "2026-08-20T00:01:00.000Z",
      latencyMs: 5_000,
    })

    expect(getHostedWorkerQuickHealth(state).runtime).toEqual({
      currentStatus: "degraded",
      consecutiveFailures: 1,
      lastErrorCode: "rate-limit",
      lastErrorAt: "2026-08-20T00:01:00.000Z",
      lastLatencyMs: 5_000,
    })

    recordHostedWorkerGenerateSuccess(state, {
      at: "2026-08-20T00:02:00.000Z",
      latencyMs: 1_500,
    })

    expect(getHostedWorkerQuickHealth(state).runtime).toEqual({
      currentStatus: "ready",
      consecutiveFailures: 0,
      lastSuccessfulGenerateAt: "2026-08-20T00:02:00.000Z",
      lastErrorCode: "rate-limit",
      lastErrorAt: "2026-08-20T00:01:00.000Z",
      lastRecoveredAt: "2026-08-20T00:02:00.000Z",
      lastLatencyMs: 1_500,
    })
  })
})
