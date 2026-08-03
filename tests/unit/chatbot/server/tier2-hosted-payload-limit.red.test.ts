import { EventEmitter } from "node:events"
import type { IncomingMessage, ServerResponse } from "node:http"
import { PassThrough } from "node:stream"

import { describe, expect, it, vi } from "vitest"

import { createHostedWorkerRequestHandler } from "@/lib/chatbot/hosted-worker/server"
import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import type {
  ChatbotLlmClient,
  ChatbotLlmRequest,
  ChatbotLlmResponse,
} from "@/lib/chatbot/server/llm-client"
import { Tier2HostedChromeNotionAiClient } from "@/lib/chatbot/server/llm-clients/tier2-hosted-chrome-notion-ai"
import {
  createChatbotLlmTierOrchestrator,
  type TierAttemptEvent,
} from "@/lib/chatbot/server/llm-orchestrator"
import { createChatbotLlmDisplayEnvelope } from "@/lib/chatbot/server/llm-response-normalizer"

const measuredPayloadBytes = 84_927
const measuredSystemPromptBytes = 83_802
const measuredStaticPromptBytes = 8_146
const measuredNoteKnowledgeBytes = 75_656
const hostedWorkerBodyLimitBytes = 64 * 1024

function productionSizedRequest(): ChatbotLlmRequest {
  const conversationState: ConversationState = {
    hasFinalMedium: false,
    hasJobKind: false,
    hasAdditionalWork: false,
    hasDocumentaryAttachments: false,
    hasWorkSite: false,
    hasReferenceUrls: false,
    hasContactEmail: false,
    hasDesiredSchedule: false,
    durationContext: {
      workflowFacts: {
        finalMedium: "other",
        workSite: "remote-grading",
      },
      knowledgeSyncedAt: "2026-08-03T00:49:09.694Z",
      snapshotStatus: "current",
    },
    turnCount: 1,
  }
  const jobContext: JobContext = {
    finalMedium: "other",
    workSite: "remote-grading",
    documentaryAttachment: { kind: "none" },
  }
  const request: ChatbotLlmRequest = {
    requestId: "205febd9-adde-422b-8b46-514dc63d457b",
    systemPrompt: "s".repeat(measuredSystemPromptBytes),
    messages: [{ role: "user", content: "相談したいです" }],
    conversationState,
    jobContext,
    latestUserMessage: "相談したいです",
    temperature: 0.2,
    maxOutputTokens: 900,
  }
  const jsonEscapeOverhead = measuredPayloadBytes - Buffer.byteLength(JSON.stringify(request), "utf8")
  request.systemPrompt =
    "s".repeat(measuredStaticPromptBytes) +
    "\n".repeat(jsonEscapeOverhead) +
    "n".repeat(measuredNoteKnowledgeBytes - jsonEscapeOverhead)

  return request
}

function tier3Response(): ChatbotLlmResponse {
  const rawText =
    '<customer_reply>案件を確認します。\n{"tool":"show_choice_panel","args":{"id":"job-kind","question":"案件の種類を教えてください","choices":[{"id":"cm","label":"CM"},{"id":"other","label":"その他"}]}}</customer_reply>'
  return {
    rawText,
    displayEnvelope: createChatbotLlmDisplayEnvelope(rawText),
    tier: "tier-3-gemini-flash",
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
  } as unknown as Response
}

function postGenerateRequest(body: string): IncomingMessage & PassThrough {
  const request = new PassThrough() as IncomingMessage & PassThrough
  request.method = "POST"
  request.url = "/generate"
  request.headers = {
    authorization: "Bearer test-token",
    "content-type": "application/json",
  }
  request.end(body)
  return request
}

type FakeResponse = ServerResponse &
  EventEmitter & {
    body?: string
    headers: Record<string, string>
    writableEnded: boolean
    destroyed: boolean
  }

function fakeResponse(): FakeResponse {
  const response = new EventEmitter() as FakeResponse
  response.headers = {}
  response.statusCode = 0
  ;(response as { writableEnded: boolean }).writableEnded = false
  ;(response as { destroyed: boolean }).destroyed = false
  response.setHeader = (name: string, value: number | string | readonly string[]) => {
    response.headers[name.toLowerCase()] = String(value)
    return response
  }
  response.end = (chunk?: unknown) => {
    response.body = typeof chunk === "string" ? chunk : chunk ? String(chunk) : ""
    ;(response as { writableEnded: boolean }).writableEnded = true
    return response
  }
  return response
}

describe("hosted Tier2 production payload boundary", () => {
  it("keeps the measured production request on Tier2 instead of falling through on body-too-large", async () => {
    const workerGenerate = vi.fn(async () => {
      const rawText = "<customer_reply>案件の種類を教えてください。</customer_reply>"
      return {
        rawText,
        displayEnvelope: createChatbotLlmDisplayEnvelope(rawText),
        tier: "tier-2-hosted-chrome-notion-ai" as const,
      }
    })
    const workerHandler = createHostedWorkerRequestHandler({
      token: "test-token",
      generate: workerGenerate,
    })
    let observedGeneratePayloadBytes = 0
    const workerHttpClient = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      if (url.pathname === "/health" || url.pathname === "/ensure-chrome") {
        return jsonResponse({ ok: true })
      }

      const body = String(init?.body ?? "")
      observedGeneratePayloadBytes = Buffer.byteLength(body, "utf8")
      const request = postGenerateRequest(body)
      const response = fakeResponse()
      await workerHandler(request, response)
      return jsonResponse(JSON.parse(response.body ?? "{}"), response.statusCode)
    })
    const tier2 = new Tier2HostedChromeNotionAiClient({
      workerUrl: "https://worker.example.test",
      token: "test-token",
      requestTimeoutMs: 1_000,
      healthCheckTimeoutMs: 1_000,
      totalGenerateBudgetMs: 2_000,
      httpClient: workerHttpClient,
    })
    const tier3 = {
      tier: "tier-3-gemini-flash",
      isHealthy: vi.fn(async () => true),
      generate: vi.fn(async () => tier3Response()),
    } satisfies ChatbotLlmClient
    const attempts: TierAttemptEvent[] = []
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier2, tier3],
      onTierAttempt: (event) => attempts.push(event),
    })
    const request = productionSizedRequest()

    const response = await orchestrator.generate(request)

    expect(Buffer.byteLength(request.systemPrompt, "utf8")).toBe(measuredSystemPromptBytes)
    expect(Buffer.byteLength(JSON.stringify(request), "utf8")).toBe(measuredPayloadBytes)
    expect(observedGeneratePayloadBytes).toBe(measuredPayloadBytes)
    expect(observedGeneratePayloadBytes).toBeGreaterThan(hostedWorkerBodyLimitBytes)
    expect(workerGenerate).not.toHaveBeenCalled()
    expect(tier3.generate).toHaveBeenCalledOnce()
    const tier2GenerateError = attempts.find(
      (attempt) =>
        attempt.tier === "tier-2-hosted-chrome-notion-ai" &&
        attempt.phase === "generate" &&
        attempt.outcome === "error",
    )
    expect(tier2GenerateError?.error).toMatchObject({
      code: "unknown",
      cause: {
        status: 400,
        summary: {
          endpoint: "/generate",
          httpStatus: 400,
          errorCode: "invalid-output",
          retryable: false,
          messagePreview: "Request body is too large.",
        },
      },
    })
    expect(attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tier: "tier-2-hosted-chrome-notion-ai",
          phase: "generate",
          outcome: "error",
        }),
        expect.objectContaining({
          tier: "tier-3-gemini-flash",
          phase: "generate",
          outcome: "success",
        }),
      ]),
    )
    expect(response.tier).toBe("tier-2-hosted-chrome-notion-ai")
  })
})
