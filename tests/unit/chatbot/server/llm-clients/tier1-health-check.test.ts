import { describe, expect, it, vi } from "vitest"

import { runTier1HealthCheck } from "@/lib/chatbot/server/llm-clients/tier1-health-check"

function logClient(previous: Array<{ responseSuccess: boolean }> = []) {
  return {
    chatbotGateVerificationLog: {
      create: vi.fn(async () => undefined),
    },
    chatbotHealthCheckLog: {
      create: vi.fn(async () => undefined),
      findMany: vi.fn(async () => previous),
    },
  }
}

function healthClient(overrides: {
  preferredModelAvailable?: boolean
  responseHeaders?: Record<string, string>
  generateError?: Error
} = {}) {
  return {
    inspectRuntimeContext: vi.fn(async () => ({
      targetUrl: "https://www.notion.so/chat?t=36b13ee3141a8073885d00a99ebb676c&wfv=chat",
      selectedModel: "apricot-sorbet-high",
      availableModels: ["apricot-sorbet-high"],
      preferredModelAvailable: overrides.preferredModelAvailable ?? true,
    })),
    generate: vi.fn(async () => {
      if (overrides.generateError) throw overrides.generateError
      return {
        rawText: "OK",
        latencyMs: 123,
        diagnostics: {
          responseHeaders: overrides.responseHeaders ?? {},
        },
      }
    }),
  }
}

describe("runTier1HealthCheck", () => {
  it("records a successful probe without alerting", async () => {
    const db = logClient()
    const sendAlert = vi.fn(async () => true)

    await expect(
      runTier1HealthCheck({
        logClient: db,
        client: healthClient(),
        now: () => new Date("2026-05-25T10:00:00.000Z"),
        sendAlert,
      }),
    ).resolves.toMatchObject({
      ok: true,
      probeAt: "2026-05-25T10:00:00.000Z",
      modelSelectorPresent: true,
      responseSuccess: true,
      alertSent: false,
    })
    expect(db.chatbotHealthCheckLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        modelSelectorPresent: true,
        responseSuccess: true,
      }),
    })
    expect(sendAlert).not.toHaveBeenCalled()
  })

  it("alerts when rate-limit remaining ratio is below 20 percent", async () => {
    const sendAlert = vi.fn(async () => true)

    await expect(
      runTier1HealthCheck({
        logClient: logClient(),
        client: healthClient({
          responseHeaders: {
            "x-ratelimit-remaining": "19",
            "x-ratelimit-limit": "100",
          },
        }),
        sendAlert,
      }),
    ).resolves.toMatchObject({
      rateLimitRemaining: 19,
      rateLimitRemainingRatio: 0.19,
      alertSent: true,
    })
    expect(sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining("rate limit low") }),
    )
  })

  it("alerts on three consecutive response failures", async () => {
    const sendAlert = vi.fn(async () => true)

    await expect(
      runTier1HealthCheck({
        logClient: logClient([{ responseSuccess: false }, { responseSuccess: false }]),
        client: healthClient({ generateError: new Error("blocked") }),
        sendAlert,
      }),
    ).resolves.toMatchObject({
      responseSuccess: false,
      consecutiveFailures: 3,
      alertSent: true,
    })
  })
})
