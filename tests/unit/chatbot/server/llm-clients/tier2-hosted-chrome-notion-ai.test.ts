import { afterEach, describe, expect, it, vi } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import {
  createTier2HostedChromeNotionAiClient,
  Tier2HostedChromeNotionAiClient,
} from "@/lib/chatbot/server/llm-clients/tier2-hosted-chrome-notion-ai"

const workerUrl = "https://worker.example"
const token = "test-worker-token"
const baseConfig = {
  workerUrl,
  token,
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
    temperature: 0.2,
    maxOutputTokens: 900,
  }
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn(async () => body),
  } as unknown as Response
}

function invalidJsonResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn(async () => {
      throw new Error("invalid json")
    }),
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

describe("Tier2HostedChromeNotionAiClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("keeps the tier property fixed to tier 2 Hosted Notion AI", () => {
    const client = createTier2HostedChromeNotionAiClient()

    expect(client.tier).toBe("tier-2-hosted-chrome-notion-ai")
  })

  it("loads worker URL, token, timeouts, and enabled flag from env", async () => {
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_WORKER_URL", "https://worker.example/")
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN", token)
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_TIMEOUT_MS", "25")
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_HEALTH_TIMEOUT_MS", "25")
    const httpClient = vi.fn(async () => jsonResponse({ rawText: "OK", tier: "worker-internal" }))
    const client = createTier2HostedChromeNotionAiClient({ httpClient })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "OK",
      tier: "tier-2-hosted-chrome-notion-ai",
    })
    expect(httpClient).toHaveBeenCalledWith(
      "https://worker.example/generate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        }),
      }),
    )
  })

  it.each(["false", "0", "off"])("reports unhealthy when explicitly disabled with %s", async (enabled) => {
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_WORKER_URL", workerUrl)
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN", token)
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_ENABLED", enabled)
    const httpClient = vi.fn(async () => jsonResponse({ ok: true }))
    const client = createTier2HostedChromeNotionAiClient({ httpClient })

    await expect(client.isHealthy()).resolves.toBe(false)
    expect(httpClient).not.toHaveBeenCalled()
    expect(client.getLastHealthError()).toMatchObject({
      code: "connection",
      tier: "tier-2-hosted-chrome-notion-ai",
    })
  })

  it("reports unhealthy when URL or token is missing", async () => {
    const httpClient = vi.fn(async () => jsonResponse({ ok: true }))
    const client = new Tier2HostedChromeNotionAiClient({ httpClient })

    await expect(client.isHealthy()).resolves.toBe(false)
    expect(httpClient).not.toHaveBeenCalled()
    expect(client.getLastHealthError()).toMatchObject({
      code: "auth",
      isRetryable: false,
    })
  })

  it("calls GET /health and returns healthy only for ok true", async () => {
    const healthyHttpClient = vi.fn(async () => jsonResponse({ ok: true }))
    const unhealthyHttpClient = vi.fn(async () => jsonResponse({ ok: false }))
    const healthyClient = hostedClient(healthyHttpClient)
    const unhealthyClient = hostedClient(unhealthyHttpClient)

    await expect(healthyClient.isHealthy()).resolves.toBe(true)
    await expect(unhealthyClient.isHealthy()).resolves.toBe(false)
    expect(healthyHttpClient).toHaveBeenCalledWith(
      "https://worker.example/health",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: `Bearer ${token}` }),
      }),
    )
  })

  it("returns raw text, routing decision, tokens, and normalized tier from /generate", async () => {
    const httpClient = vi.fn(async () =>
      jsonResponse({
        rawText: "候補日を 2 つ確認しました。",
        tier: "tier-1-chrome-notion-ai",
        tokensUsed: 123,
        latencyMs: 456,
        proposedRoutingDecision: { kind: "continue", nextQuestion: "希望時期を教えてください" },
      }),
    )
    const client = hostedClient(httpClient)

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "候補日を 2 つ確認しました。",
      tier: "tier-2-hosted-chrome-notion-ai",
      tokensUsed: 123,
      diagnostics: {
        endpoint: "/generate",
        workerLatencyMs: 456,
      },
      proposedRoutingDecision: { kind: "continue", nextQuestion: "希望時期を教えてください" },
    })
    expect(httpClient).toHaveBeenCalledWith(
      "https://worker.example/generate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(llmRequest()),
      }),
    )
  })

  it("does not copy arbitrary worker diagnostics into the HP response", async () => {
    const client = hostedClient(async () =>
      jsonResponse({
        rawText: "OK",
        diagnostics: { token: "should-not-propagate", requestBody: "should-not-propagate" },
      }),
    )

    await expect(client.generate(llmRequest())).resolves.not.toMatchObject({
      diagnostics: expect.objectContaining({
        token: expect.anything(),
        requestBody: expect.anything(),
      }),
    })
  })

  it("maps authentication, rate-limit, server, invalid JSON, and invalid response failures", async () => {
    await expectLlmError(hostedClient(async () => jsonResponse({}, { ok: false, status: 401 })).generate(llmRequest()), {
      code: "auth",
      isRetryable: false,
    })
    await expectLlmError(hostedClient(async () => jsonResponse({}, { ok: false, status: 403 })).generate(llmRequest()), {
      code: "auth",
      isRetryable: false,
    })
    await expectLlmError(hostedClient(async () => jsonResponse({}, { ok: false, status: 429 })).generate(llmRequest()), {
      code: "rate-limit",
      isRetryable: true,
    })
    await expectLlmError(hostedClient(async () => jsonResponse({}, { ok: false, status: 503 })).generate(llmRequest()), {
      code: "connection",
      isRetryable: true,
    })
    await expectLlmError(hostedClient(async () => invalidJsonResponse()).generate(llmRequest()), {
      code: "invalid-output",
      isRetryable: false,
    })
    await expectLlmError(hostedClient(async () => jsonResponse({ rawText: "" })).generate(llmRequest()), {
      code: "invalid-output",
      isRetryable: false,
    })
  })

  it("maps timeout and connection failures", async () => {
    const timeoutClient = new Tier2HostedChromeNotionAiClient({
      ...baseConfig,
      requestTimeoutMs: 1,
      httpClient: async () => new Promise(() => undefined),
    })
    const disconnectedClient = hostedClient(async () => {
      throw new Error("ECONNREFUSED")
    })

    await expectLlmError(timeoutClient.generate(llmRequest()), {
      code: "timeout",
      isRetryable: true,
    })
    await expectLlmError(disconnectedClient.generate(llmRequest()), {
      code: "connection",
      isRetryable: true,
    })
  })
})
