import { afterEach, describe, expect, it, vi } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import {
  createTier3GeminiFlashLiteClient,
  Tier3GeminiFlashLiteClient,
} from "@/lib/chatbot/server/llm-clients/tier3-gemini-flash-lite"
import geminiFlashLiteFixture from "@/lib/chatbot/server/llm-clients/fixtures/tier3-gemini-flash-lite-response.json"
import { normalizeChatbotLlmResponse } from "@/lib/chatbot/server/llm-response-normalizer"

const apiKey = "test-gemini-key"
const modelName = "gemini-2.5-flash-lite"
const baseConfig = {
  baseUrl: "https://generativelanguage.googleapis.com",
  apiKey,
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
    messages: [
      { role: "user", content: "来月のWeb CM案件です" },
      { role: "assistant", content: "公開時期は決まっていますか？" },
    ],
    latestUserMessage: "立ち会い候補を相談したいです",
    conversationState: conversationState(),
    jobContext: jobContext(),
    temperature: 0.2,
    maxOutputTokens: 512,
  }
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn(async () => body),
  } as unknown as Response
}

function geminiClient(httpClient: (input: string, init?: RequestInit) => Promise<Response>) {
  return new Tier3GeminiFlashLiteClient({
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
    tier: "tier-3-gemini-flash-lite",
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("Tier3GeminiFlashLiteClient", () => {
  it("keeps the tier property fixed to tier 3 Gemini Flash-Lite", () => {
    const client = createTier3GeminiFlashLiteClient({ apiKey })

    expect(client.tier).toBe("tier-3-gemini-flash-lite")
  })

  it("returns joined candidate parts and request metadata when Gemini returns valid text", async () => {
    const httpClient = vi.fn(async () =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "候補日を" }, { text: "確認しました。" }] } }],
        usageMetadata: { totalTokenCount: 42 },
      }),
    )
    const client = geminiClient(httpClient)

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "候補日を確認しました。",
      tier: "tier-3-gemini-flash-lite",
      tokensUsed: 42,
    })
    expect(httpClient).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=test-gemini-key",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("normalizes the captured Gemini Flash-Lite response fixture to the shared schema", async () => {
    const client = geminiClient(async () => jsonResponse(geminiFlashLiteFixture))

    const response = await client.generate(llmRequest())
    const normalized = normalizeChatbotLlmResponse(response)

    expect(normalized).toMatchObject({
      content: "内容を整理しました。日程候補を確認して、のりかねさんに共有します。",
      role: "assistant",
      model: "tier-3-gemini-flash-lite",
      finish_reason: "stop",
    })
  })

  it("uses preferredModel for the generateContent model path", async () => {
    const httpClient = vi.fn(async (input: string, init?: RequestInit) => {
      void input
      void init
      return jsonResponse({ candidates: [{ content: { parts: [{ text: "OK" }] } }] })
    })
    const client = new Tier3GeminiFlashLiteClient({
      ...baseConfig,
      preferredModel: "gemini-custom-policy-model",
      httpClient,
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({ rawText: "OK" })
    expect(httpClient.mock.calls[0]?.[0]).toContain(
      "/v1beta/models/gemini-custom-policy-model:generateContent",
    )
  })

  it("loads API key and model from env in the factory", async () => {
    vi.stubEnv("GEMINI_API_KEY", apiKey)
    vi.stubEnv("CHATBOT_TIER3_GEMINI_MODEL", "gemini-env-model")
    const httpClient = vi.fn(async (input: string, init?: RequestInit) => {
      void input
      void init
      return jsonResponse({ candidates: [{ content: { parts: [{ text: "OK" }] } }] })
    })
    const client = createTier3GeminiFlashLiteClient({ httpClient })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({ rawText: "OK" })
    expect(httpClient.mock.calls[0]?.[0]).toContain(
      "/v1beta/models/gemini-env-model:generateContent",
    )
  })

  it("uses the tier-specific API key env as fallback after GEMINI_API_KEY", async () => {
    vi.stubEnv("CHATBOT_TIER3_GEMINI_API_KEY", "fallback-key")
    const httpClient = vi.fn(async (input: string, init?: RequestInit) => {
      void input
      void init
      return jsonResponse({ candidates: [{ content: { parts: [{ text: "OK" }] } }] })
    })
    const client = createTier3GeminiFlashLiteClient({ httpClient })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({ rawText: "OK" })
    expect(httpClient.mock.calls[0]?.[0]).toContain("key=fallback-key")
  })

  it("returns unhealthy and throws auth when the API key is missing", async () => {
    const client = new Tier3GeminiFlashLiteClient({
      ...baseConfig,
      apiKey: "",
      httpClient: vi.fn(async () => jsonResponse({})),
    })

    await expect(client.isHealthy()).resolves.toBe(false)
    await expectLlmError(client.generate(llmRequest()), {
      code: "auth",
      isRetryable: false,
    })
  })

  it.each([401, 403])("maps HTTP %i to a non-retryable auth error", async (status) => {
    const client = geminiClient(async () => jsonResponse({}, { ok: false, status }))

    await expectLlmError(client.generate(llmRequest()), {
      code: "auth",
      isRetryable: false,
    })
  })

  it("maps HTTP 429 to a retryable rate-limit error", async () => {
    const client = geminiClient(async () => jsonResponse({}, { ok: false, status: 429 }))

    await expectLlmError(client.generate(llmRequest()), {
      code: "rate-limit",
      isRetryable: true,
    })
  })

  it("maps HTTP 5xx to a retryable connection error", async () => {
    const client = geminiClient(async () => jsonResponse({}, { ok: false, status: 503 }))

    await expectLlmError(client.generate(llmRequest()), {
      code: "connection",
      isRetryable: true,
    })
  })

  it("maps fetch failures to retryable connection errors", async () => {
    const client = geminiClient(async () => {
      throw new Error("ENOTFOUND")
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "connection",
      isRetryable: true,
    })
  })

  it("maps request timeout to a retryable timeout error", async () => {
    const client = new Tier3GeminiFlashLiteClient({
      ...baseConfig,
      requestTimeoutMs: 1,
      httpClient: async () => new Promise(() => undefined),
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "timeout",
      isRetryable: true,
    })
  })

  it("maps abort-like fetch failures to retryable connection errors", async () => {
    const client = geminiClient(async () => {
      throw new Error("AbortError")
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "connection",
      isRetryable: true,
    })
  })

  it("throws invalid-output when Gemini omits candidates", async () => {
    const client = geminiClient(async () => jsonResponse({ candidates: [] }))

    await expectLlmError(client.generate(llmRequest()), {
      code: "invalid-output",
      isRetryable: false,
    })
  })

  it("throws invalid-output when Gemini omits text parts", async () => {
    const client = geminiClient(async () =>
      jsonResponse({ candidates: [{ content: { parts: [{ inlineData: {} }] } }] }),
    )

    await expectLlmError(client.generate(llmRequest()), {
      code: "invalid-output",
      isRetryable: false,
    })
  })

  it("puts system and conversation prompts into Gemini payload parts", async () => {
    const httpClient = vi.fn(async (input: string, init?: RequestInit) => {
      void input
      void init
      return jsonResponse({ candidates: [{ content: { parts: [{ text: "OK" }] } }] })
    })
    const client = geminiClient(httpClient)

    await client.generate(llmRequest())

    const init = httpClient.mock.calls[0]?.[1]
    const payload = JSON.parse(String(init?.body))

    expect(payload).toMatchObject({
      systemInstruction: {
        parts: [{ text: "Collect only new project intake details." }],
      },
      contents: [
        { role: "user", parts: [{ text: "来月のWeb CM案件です" }] },
        { role: "model", parts: [{ text: "公開時期は決まっていますか？" }] },
        { role: "user", parts: [{ text: "立ち会い候補を相談したいです" }] },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
      },
    })
  })

  it("returns healthy when an API key is set and the base URL responds", async () => {
    const httpClient = vi.fn(async () => jsonResponse({}))
    const client = geminiClient(httpClient)

    await expect(client.isHealthy()).resolves.toBe(true)
    expect(httpClient).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com",
      expect.objectContaining({ method: "HEAD" }),
    )
  })

  it("returns unhealthy when base URL reachability fails", async () => {
    const client = geminiClient(async () => {
      throw new Error("network down")
    })

    await expect(client.isHealthy()).resolves.toBe(false)
  })
})
