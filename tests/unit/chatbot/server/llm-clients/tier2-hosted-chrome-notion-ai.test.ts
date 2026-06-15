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

describe("Tier2HostedChromeNotionAiClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
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
      "https://worker.example.test/health",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: "Bearer test-token" },
      }),
    )
  })

  it("posts the current ChatbotLlmRequest body to /generate", async () => {
    const httpClient = vi.fn(async () => jsonResponse({ rawText: "承知しました", tokensUsed: 12, latencyMs: 34 }))
    const client = hostedClient(httpClient)
    const request = llmRequest()

    await expect(client.generate(request)).resolves.toMatchObject({
      rawText: "承知しました",
      tier: "tier-2-hosted-chrome-notion-ai",
      tokensUsed: 12,
      diagnostics: { endpoint: "/generate", workerLatencyMs: 34 },
    })
    expect(httpClient).toHaveBeenCalledWith(
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

  it("loads worker URL, token, and enabled flag from tier-specific env", async () => {
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_WORKER_URL", "https://env-worker.example.test/")
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN", "env-token")
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_ENABLED", "true")
    const httpClient = vi.fn(async () => jsonResponse({ rawText: "OK" }))
    const client = createTier2HostedChromeNotionAiClient({
      requestTimeoutMs: 20,
      healthCheckTimeoutMs: 20,
      httpClient,
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({ rawText: "OK" })
    expect(httpClient).toHaveBeenCalledWith(
      "https://env-worker.example.test/generate",
      expect.any(Object),
    )
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
})
