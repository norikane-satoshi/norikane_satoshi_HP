import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import {
  createTier2HostedChromeNotionAiClient,
  Tier2HostedChromeNotionAiClient,
} from "@/lib/chatbot/server/llm-clients/tier2-hosted-chrome-notion-ai"

const baseConfig = {
  workerUrl: "https://worker.example.test",
  token: "test-token",
  requestTimeoutMs: 20,
  healthCheckTimeoutMs: 20,
} as const

function conversationState(): ConversationState {
  return {
    hasFinalMedium: true,
    hasJobKind: true,
    hasAdditionalWork: true,
    hasDocumentaryAttachments: true,
    hasWorkSite: true,
    hasReferenceUrls: true,
    hasContactEmail: true,
    hasDesiredSchedule: true,
    turnCount: 1,
  }
}

function jobContext(): JobContext {
  return {
    jobKind: "cm-30s",
    finalMedium: "web",
    workSite: "remote-grading",
    documentaryAttachment: { kind: "none" },
  }
}

function llmRequest(): ChatbotLlmRequest {
  return {
    systemPrompt: "Collect only new project intake details.",
    messages: [{ role: "user", content: "来月のWeb CM案件です" }],
    latestUserMessage: "立ち会い候補を相談したいです",
    conversationState: conversationState(),
    jobContext: jobContext(),
  }
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn(async () => body),
  } as unknown as Response
}

function hostedClient(httpClient: (input: string, init?: RequestInit) => Promise<Response>) {
  return new Tier2HostedChromeNotionAiClient({
    ...baseConfig,
    httpClient,
  })
}

async function expectLlmError(
  promise: Promise<unknown>,
  expected: { code: ChatbotLlmError["code"]; isRetryable: boolean },
) {
  await expect(promise).rejects.toBeInstanceOf(ChatbotLlmError)
  await expect(promise).rejects.toMatchObject({
    code: expected.code,
    isRetryable: expected.isRetryable,
    tier: "tier-2-hosted-chrome-notion-ai",
  })
}

async function flushMicrotasks(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

describe("Tier2HostedChromeNotionAiClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("keeps the tier property fixed to tier 2 hosted Notion AI", () => {
    const client = createTier2HostedChromeNotionAiClient(baseConfig)

    expect(client.tier).toBe("tier-2-hosted-chrome-notion-ai")
  })

  it("uses /health with bearer authorization for health checks", async () => {
    const httpClient = vi.fn(async () => jsonResponse({ ok: true }))
    const client = hostedClient(httpClient)

    await expect(client.isHealthy()).resolves.toBe(true)
    expect(httpClient).toHaveBeenCalledWith(
      "https://worker.example.test/health?mode=quick",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: "Bearer test-token" },
      }),
    )
  })

  it("ensures Chrome before posting the current ChatbotLlmRequest body to /generate", async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "ready" }))
      .mockResolvedValueOnce(jsonResponse({ rawText: "承知しました", tokensUsed: 12, latencyMs: 34 }))
    const client = hostedClient(httpClient)
    const request = llmRequest()

    await expect(client.generate(request)).resolves.toMatchObject({
      rawText: "承知しました",
      tier: "tier-2-hosted-chrome-notion-ai",
      tokensUsed: 12,
      diagnostics: {
        endpoint: "/generate",
        workerLatencyMs: 34,
        attemptCount: 1,
        repairAttempted: false,
        retryReasons: [],
      },
    })
    expect(httpClient).toHaveBeenNthCalledWith(
      1,
      "https://worker.example.test/ensure-chrome",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer test-token" },
      }),
    )
    expect(httpClient).toHaveBeenNthCalledWith(
      2,
      "https://worker.example.test/generate",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      }),
    )
  })

  it("repairs Chrome and retries once when hosted generate returns a fast server error", async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ rawText: "復旧しました", latencyMs: 25 }))
    const client = hostedClient(httpClient)

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "復旧しました",
      tier: "tier-2-hosted-chrome-notion-ai",
      diagnostics: {
        attemptCount: 2,
        repairAttempted: true,
        retryReasons: ["server-error"],
      },
    })
    expect(httpClient).toHaveBeenNthCalledWith(
      3,
      "https://worker.example.test/ensure-chrome",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer test-token" },
      }),
    )
    expect(httpClient).toHaveBeenNthCalledWith(
      4,
      "https://worker.example.test/generate",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("retries a second repair pass for short hosted generate server errors", async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 502 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ rawText: "2回目で復旧しました", latencyMs: 31 }))
    const client = hostedClient(httpClient)

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "2回目で復旧しました",
      tier: "tier-2-hosted-chrome-notion-ai",
      diagnostics: {
        attemptCount: 3,
        repairAttempted: true,
        retryReasons: ["server-error", "server-error"],
      },
    })
    expect(httpClient).toHaveBeenCalledTimes(6)
    expect(httpClient).toHaveBeenNthCalledWith(
      6,
      "https://worker.example.test/generate",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("does not allow timeout retries to spend three full per-attempt timeouts", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    const httpClient = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockImplementationOnce(() => new Promise<Response>(() => undefined))
    const client = new Tier2HostedChromeNotionAiClient({
      ...baseConfig,
      requestTimeoutMs: 20,
      healthCheckTimeoutMs: 5,
      totalGenerateBudgetMs: 24,
      httpClient,
    })

    const promise = client.generate(llmRequest())
    const rejection = promise.catch((error: unknown) => error)
    await flushMicrotasks()
    expect(httpClient).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(20)

    await expect(rejection).resolves.toMatchObject({
      code: "timeout",
      isRetryable: true,
      cause: {
        retryDiagnostics: {
          attemptCount: 1,
          exhausted: true,
          fallbackReason: "timeout",
          retryReasons: [],
        },
      },
    })
    expect(httpClient).toHaveBeenCalledTimes(2)
  })

  it("aborts the hosted worker fetch when the per-attempt timeout elapses", async () => {
    vi.useFakeTimers()
    const seenSignals: AbortSignal[] = []
    const httpClient = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockImplementationOnce((_input: string, init?: RequestInit) => {
        if (init?.signal) seenSignals.push(init.signal)
        return new Promise<Response>(() => undefined)
      })
    const client = new Tier2HostedChromeNotionAiClient({
      ...baseConfig,
      requestTimeoutMs: 20,
      healthCheckTimeoutMs: 5,
      totalGenerateBudgetMs: 24,
      httpClient,
    })

    const promise = client.generate(llmRequest()).catch((error: unknown) => error)
    await flushMicrotasks()
    expect(seenSignals).toHaveLength(1)
    expect(seenSignals[0]?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(20)

    await expect(promise).resolves.toMatchObject({
      code: "timeout",
      isRetryable: true,
    })
    expect(seenSignals[0]?.aborted).toBe(true)
  })

  it("loads worker URL, token, enabled flag, and total budget from tier-specific env", async () => {
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_WORKER_URL", "https://env-worker.example.test/")
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN", "env-token")
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_TOTAL_BUDGET_MS", "12345")
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_ENABLED", "true")
    const httpClient = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ rawText: "OK" }))
    const client = createTier2HostedChromeNotionAiClient({
      requestTimeoutMs: 20,
      healthCheckTimeoutMs: 20,
      httpClient,
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "OK",
      diagnostics: { totalGenerateBudgetMs: 12345 },
    })
    expect(httpClient).toHaveBeenCalledWith(
      "https://env-worker.example.test/generate",
      expect.any(Object),
    )
  })

  it("loads worker config from .env.local when process env is not populated", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tier2-env-"))
    writeFileSync(
      join(tempDir, ".env.local"),
      [
        "CHATBOT_HOSTED_NOTION_AI_WORKER_URL=https://local-env-worker.example.test/",
        "CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN=local-env-token",
        "CHATBOT_HOSTED_NOTION_AI_ENABLED=true",
      ].join("\n"),
    )
    vi.spyOn(process, "cwd").mockReturnValue(tempDir)
    const httpClient = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ rawText: "OK" }))

    try {
      const client = createTier2HostedChromeNotionAiClient({
        requestTimeoutMs: 20,
        healthCheckTimeoutMs: 20,
        httpClient,
      })

      await expect(client.generate(llmRequest())).resolves.toMatchObject({ rawText: "OK" })
      expect(httpClient).toHaveBeenCalledWith(
        "https://local-env-worker.example.test/generate",
        expect.objectContaining({
          headers: expect.objectContaining({ authorization: "Bearer local-env-token" }),
        }),
      )
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("treats missing URL or token as non-retryable auth failure", async () => {
    const client = createTier2HostedChromeNotionAiClient({
      workerUrl: "",
      token: "",
      requestTimeoutMs: 20,
      healthCheckTimeoutMs: 20,
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "auth",
      isRetryable: false,
    })
  })

  it("preserves sanitized hosted worker 502 details and retry exhaustion diagnostics on the LLM error cause", async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "ready" }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "connection",
              message: 'No Notion AI page target was found. "latestUserMessage":"secret client note"',
              retryable: true,
            },
          },
          { ok: false, status: 502 },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "ready" }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "connection",
              message: "Chrome CDP target still missing after repair.",
              retryable: true,
            },
          },
          { ok: false, status: 502 },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "ready" }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "connection",
              message: "Chrome CDP target still missing after second repair.",
              retryable: true,
            },
          },
          { ok: false, status: 502 },
        ),
      )
    const client = hostedClient(httpClient)

    await expect(client.generate(llmRequest())).rejects.toMatchObject({
      code: "connection",
      isRetryable: true,
      cause: {
        endpoint: "/generate",
        httpStatus: 502,
        errorCode: "connection",
        retryable: true,
        messagePreview: "Chrome CDP target still missing after second repair.",
        retryDiagnostics: {
          attemptCount: 3,
          exhausted: true,
          fallbackReason: "server-error",
          retryReasons: ["server-error", "server-error"],
        },
      },
    })
  })

  it("does not retry a hosted worker rate limit when the worker marks it non-retryable", async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "ready" }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "rate-limit",
              message: "Notion AI rate limit response was returned.",
              retryable: false,
            },
          },
          { ok: false, status: 429 },
        ),
      )
    const client = hostedClient(httpClient)

    await expect(client.generate(llmRequest())).rejects.toMatchObject({
      code: "rate-limit",
      isRetryable: false,
      cause: {
        endpoint: "/generate",
        httpStatus: 429,
        errorCode: "rate-limit",
        retryable: false,
        retryDiagnostics: {
          attemptCount: 1,
          exhausted: true,
          fallbackReason: "rate-limit",
          retryReasons: [],
        },
      },
    })
    expect(httpClient).toHaveBeenCalledTimes(2)
  })
})
