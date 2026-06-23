import { describe, expect, it, vi } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import {
  createTier3GeminiFlashClient,
  Tier3GeminiFlashClient,
} from "@/lib/chatbot/server/llm-clients/tier3-gemini-flash"

const apiKey = "test-gemini-key"

function conversationState(): ConversationState {
  return {
    hasFinalMedium: true,
    hasJobKind: true,
    hasAdditionalWork: true,
    hasDocumentaryAttachments: true,
    hasWorkSite: true,
    hasReferenceUrls: true,
    hasContactEmail: false,
    hasDesiredSchedule: false,
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
    maxOutputTokens: 300,
  }
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn(async () => body),
  } as unknown as Response
}

function client(httpClient: (input: string, init?: RequestInit) => Promise<Response>) {
  return new Tier3GeminiFlashClient({
    apiKey,
    modelName: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com",
    requestTimeoutMs: 20,
    healthCheckTimeoutMs: 20,
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
    tier: "tier-3-gemini-flash",
  })
}

describe("Tier3GeminiFlashClient", () => {
  it("keeps the tier fixed to tier 3 Gemini Flash", () => {
    expect(createTier3GeminiFlashClient({ apiKey }).tier).toBe("tier-3-gemini-flash")
  })

  it("checks model availability with x-goog-api-key without putting the key in the URL", async () => {
    const httpClient = vi.fn(async () => jsonResponse({ name: "models/gemini-2.5-flash" }))
    const gemini = client(httpClient)

    await expect(gemini.isHealthy()).resolves.toBe(true)
    expect(httpClient).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash",
      expect.objectContaining({
        method: "GET",
        headers: { "x-goog-api-key": apiKey },
      }),
    )
  })

  it("generates text and normalizes the response to the chatbot LLM contract", async () => {
    const httpClient = vi.fn(async () =>
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: "対応可能です。最終媒体を教えてください。" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { totalTokenCount: 42 },
        modelVersion: "gemini-2.5-flash",
      }),
    )
    const gemini = client(httpClient)
    const request = llmRequest()

    await expect(gemini.generate(request)).resolves.toMatchObject({
      rawText: "対応可能です。最終媒体を教えてください。",
      tier: "tier-3-gemini-flash",
      tokensUsed: 42,
      diagnostics: {
        endpoint: "/v1beta/models/gemini-2.5-flash:generateContent",
        model: "gemini-2.5-flash",
        finishReason: "STOP",
      },
    })
    const firstCall = httpClient.mock.calls[0] as unknown as [string, RequestInit] | undefined
    expect(firstCall).toBeDefined()
    const body = JSON.parse(String(firstCall![1].body))
    expect(body).toMatchObject({
      systemInstruction: { parts: [{ text: request.systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: "来月のWeb CM案件です" }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 300 },
    })
  })

  it("maps auth, rate-limit, server, empty, timeout, and connection failures", async () => {
    await expectLlmError(client(async () => jsonResponse({}, { ok: false, status: 403 })).generate(llmRequest()), {
      code: "auth",
      isRetryable: false,
    })
    await expectLlmError(client(async () => jsonResponse({}, { ok: false, status: 429 })).generate(llmRequest()), {
      code: "rate-limit",
      isRetryable: true,
    })
    await expectLlmError(client(async () => jsonResponse({}, { ok: false, status: 503 })).generate(llmRequest()), {
      code: "connection",
      isRetryable: true,
    })
    await expectLlmError(client(async () => jsonResponse({ candidates: [] })).generate(llmRequest()), {
      code: "invalid-output",
      isRetryable: false,
    })
    await expectLlmError(
      new Tier3GeminiFlashClient({
        apiKey,
        requestTimeoutMs: 1,
        healthCheckTimeoutMs: 1,
        httpClient: async () => new Promise(() => undefined),
      }).generate(llmRequest()),
      {
        code: "timeout",
        isRetryable: true,
      },
    )
    await expectLlmError(client(async () => {
      throw new Error("ECONNRESET")
    }).generate(llmRequest()), {
      code: "connection",
      isRetryable: true,
    })
  })
})
