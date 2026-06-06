import { afterEach, describe, expect, it, vi } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import {
  createTier2OllamaDeepSeekClient,
  Tier2OllamaDeepSeekClient,
  tier2OllamaDeepSeekDefaults,
} from "@/lib/chatbot/server/llm-clients/tier2-ollama-deepseek"

const modelName = "hf.co/cyberagent/DeepSeek-R1-Distill-Qwen-Japanese-14B-gguf:Q4_K_M"
const resolvedModelName = "hf.co/mmnga/cyberagent-DeepSeek-R1-Distill-Qwen-14B-Japanese-gguf:Q4_K_M"
const baseConfig = {
  baseUrl: "http://localhost:11434",
  modelName,
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

function ollamaClient(httpClient: (input: string, init?: RequestInit) => Promise<Response>) {
  return new Tier2OllamaDeepSeekClient({
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
    tier: "tier-2-ollama-deepseek",
  })
}

describe("Tier2OllamaDeepSeekClient", () => {
  it("keeps the default request bounded for local Ollama generation", () => {
    expect(tier2OllamaDeepSeekDefaults.requestTimeoutMs).toBe(45000)
    expect(tier2OllamaDeepSeekDefaults.maxOutputTokens).toBe(120)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("keeps the tier property fixed to tier 2 Ollama DeepSeek", () => {
    const client = createTier2OllamaDeepSeekClient()

    expect(client.tier).toBe("tier-2-ollama-deepseek")
  })

  it("uses the locally installed HF model host by default", async () => {
    const httpClient = vi.fn(async () =>
      jsonResponse({ model: resolvedModelName, message: { content: "OK" } }),
    )
    const client = createTier2OllamaDeepSeekClient({ ...baseConfig, modelName: resolvedModelName, httpClient })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "OK",
      diagnostics: { model: resolvedModelName },
    })
  })

  it("loads Ollama base URL and model name from tier-specific env", async () => {
    vi.stubEnv("CHATBOT_TIER2_OLLAMA_BASE_URL", "http://127.0.0.1:11435")
    vi.stubEnv("CHATBOT_TIER2_OLLAMA_MODEL", "local-model:Q4_K_M")
    const httpClient = vi.fn(async () => jsonResponse({ message: { content: "OK" } }))
    const client = createTier2OllamaDeepSeekClient({
      requestTimeoutMs: 20,
      healthCheckTimeoutMs: 20,
      httpClient,
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({ rawText: "OK" })
    expect(httpClient).toHaveBeenCalledWith(
      "http://127.0.0.1:11435/api/chat",
      expect.objectContaining({
        body: expect.stringContaining("local-model:Q4_K_M"),
      }),
    )
  })

  it("reports Ollama load time and tokens per second when timings are present", async () => {
    const httpClient = vi.fn(async () =>
      jsonResponse({
        model: modelName,
        message: { content: "OK" },
        load_duration: 2_000_000_000,
        eval_count: 24,
        eval_duration: 2_000_000_000,
      }),
    )
    const client = ollamaClient(httpClient)

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      diagnostics: {
        model: modelName,
        loadDurationMs: 2000,
        evalCount: 24,
        evalDurationMs: 2000,
        tokensPerSecond: 12,
      },
    })
  })

  it("returns raw text and tier when Ollama returns a valid chat response", async () => {
    const httpClient = vi.fn(async () =>
      jsonResponse({ message: { content: "候補日を 2 つ確認しました。" } }),
    )
    const client = ollamaClient(httpClient)

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "候補日を 2 つ確認しました。",
      tier: "tier-2-ollama-deepseek",
    })
    expect(httpClient).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: "Collect only new project intake details." },
            { role: "user", content: "来月のWeb CM案件です" },
            { role: "user", content: "立ち会い候補を相談したいです" },
          ],
          stream: false,
          options: {
            temperature: 0.2,
            num_predict: 120,
          },
        }),
      }),
    )
  })

  it("caps requested output tokens so local Ollama returns before fallback timeout", async () => {
    const httpClient = vi.fn(async () => jsonResponse({ message: { content: "OK" } }))
    const client = ollamaClient(httpClient)

    await expect(client.generate({ ...llmRequest(), temperature: 0.4, maxOutputTokens: 900 })).resolves.toMatchObject({
      rawText: "OK",
    })
    expect(httpClient).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({
        body: expect.stringContaining('"options":{"temperature":0.4,"num_predict":120}'),
      }),
    )
  })

  it("throws a retryable connection error when fetch fails", async () => {
    const client = ollamaClient(async () => {
      throw new Error("ECONNREFUSED")
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "connection",
      isRetryable: true,
    })
  })

  it("throws a retryable timeout error when the request exceeds requestTimeoutMs", async () => {
    const client = new Tier2OllamaDeepSeekClient({
      ...baseConfig,
      requestTimeoutMs: 1,
      httpClient: async () => new Promise(() => undefined),
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "timeout",
      isRetryable: true,
    })
  })

  it("throws a non-retryable invalid-output error when Ollama returns empty content", async () => {
    const client = ollamaClient(async () => jsonResponse({ message: { content: "" } }))

    await expectLlmError(client.generate(llmRequest()), {
      code: "invalid-output",
      isRetryable: false,
    })
  })

  it("throws a non-retryable invalid-output error when Ollama omits message content", async () => {
    const client = ollamaClient(async () => jsonResponse({ message: {} }))

    await expectLlmError(client.generate(llmRequest()), {
      code: "invalid-output",
      isRetryable: false,
    })
  })

  it("throws a retryable rate-limit error when Ollama or its proxy returns HTTP 429", async () => {
    const client = ollamaClient(async () => jsonResponse({}, { ok: false, status: 429 }))

    await expectLlmError(client.generate(llmRequest()), {
      code: "rate-limit",
      isRetryable: true,
    })
  })

  it("returns healthy only when the configured model is listed by Ollama", async () => {
    const healthyClient = ollamaClient(async () => jsonResponse({ models: [{ name: modelName }] }))
    const missingModelClient = ollamaClient(async () =>
      jsonResponse({ models: [{ name: "different-model" }] }),
    )
    const disconnectedClient = ollamaClient(async () => {
      throw new Error("Ollama unavailable")
    })

    await expect(healthyClient.isHealthy()).resolves.toBe(true)
    await expect(missingModelClient.isHealthy()).resolves.toBe(false)
    await expect(disconnectedClient.isHealthy()).resolves.toBe(false)
  })
})
