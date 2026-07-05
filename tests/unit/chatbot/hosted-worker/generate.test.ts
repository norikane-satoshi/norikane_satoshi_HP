import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import { createChatbotLlmDisplayEnvelope } from "@/lib/chatbot/server/llm-response-normalizer"
import { createHostedWorkerRuntimeState } from "@/lib/chatbot/hosted-worker/health"
import {
  createHostedWorkerQueue,
  generateHostedWorkerResponse,
} from "@/lib/chatbot/hosted-worker/generate"

function llmRequest(requestId = "req_1"): ChatbotLlmRequest {
  return {
    requestId,
    systemPrompt: "system prompt must not be logged",
    messages: [{ role: "user", content: "user prompt must not be logged" }],
    latestUserMessage: "latest user message must not be logged",
    conversationState: {
      hasFinalMedium: true,
      hasJobKind: true,
      hasAdditionalWork: true,
      hasDocumentaryAttachments: true,
      hasWorkSite: true,
      hasReferenceUrls: true,
      hasContactEmail: true,
      hasDesiredSchedule: true,
      turnCount: 1,
    },
    jobContext: {
      jobKind: "cm-30s",
      finalMedium: "web",
      workSite: "remote-grading",
      documentaryAttachment: { kind: "none" },
    },
  }
}

function readJsonl(pathname: string): Record<string, unknown>[] {
  return readFileSync(pathname, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("hosted worker generate", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it("propagates abort to active generation and records safe diagnostics", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hosted-worker-generate-"))
    const diagnosticsPath = path.join(dir, "generate.jsonl")
    const state = createHostedWorkerRuntimeState()
    const queue = createHostedWorkerQueue(state)
    const abortController = new AbortController()
    const generate = vi.fn((_request: ChatbotLlmRequest, options?: { signal?: AbortSignal }) => {
      return new Promise<never>((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () =>
            reject(
              new ChatbotLlmError({
                message: "aborted",
                code: "timeout",
                tier: "tier-1-chrome-notion-ai",
                isRetryable: true,
                cause: { errorCode: "request_aborted", aborted: true },
              }),
            ),
          { once: true },
        )
      })
    })

    const promise = generateHostedWorkerResponse(llmRequest("req_abort"), state, queue, {
      signal: abortController.signal,
      diagnosticsPath,
      clientFactory: () => ({ generate }),
    })
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    abortController.abort()

    await expect(promise).rejects.toMatchObject({
      code: "timeout",
      isRetryable: true,
      tier: "tier-2-hosted-chrome-notion-ai",
    })
    expect(state.queue.inFlight).toBe(false)
    expect(state.queue.queueLength).toBe(0)

    const [event] = readJsonl(diagnosticsPath)
    expect(event).toMatchObject({
      event: "hosted_worker_generate",
      requestId: "req_abort",
      outcome: "error",
      aborted: true,
      errorCode: "request_aborted",
    })
    expect(JSON.stringify(event)).not.toContain("system prompt")
    expect(JSON.stringify(event)).not.toContain("latest user message")
    rmSync(dir, { recursive: true, force: true })
  })

  it("does not run an aborted queued request after the active request finishes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hosted-worker-queue-"))
    const diagnosticsPath = path.join(dir, "generate.jsonl")
    const state = createHostedWorkerRuntimeState()
    const queue = createHostedWorkerQueue(state)
    let releaseActive!: () => void
    const generate = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseActive = () =>
              resolve({
                rawText: "active done",
                displayEnvelope: createChatbotLlmDisplayEnvelope("active done"),
                tier: "tier-1-chrome-notion-ai",
              })
          }),
      )
      .mockResolvedValue({
        rawText: "queued should not run",
        displayEnvelope: createChatbotLlmDisplayEnvelope("queued should not run"),
        tier: "tier-1-chrome-notion-ai",
      })
    const queuedAbort = new AbortController()
    const active = generateHostedWorkerResponse(llmRequest("req_active"), state, queue, {
      diagnosticsPath,
      clientFactory: () => ({ generate }),
    })
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    const queued = generateHostedWorkerResponse(llmRequest("req_queued"), state, queue, {
      signal: queuedAbort.signal,
      diagnosticsPath,
      clientFactory: () => ({ generate }),
    })
    await vi.waitFor(() => expect(state.queue.queueLength).toBe(1))
    queuedAbort.abort()

    await expect(queued).rejects.toMatchObject({ code: "timeout" })
    expect(state.queue.queueLength).toBe(0)
    releaseActive()
    await expect(active).resolves.toMatchObject({ rawText: "active done" })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(generate).toHaveBeenCalledTimes(1)
    const events = readJsonl(diagnosticsPath)
    expect(events.map((event) => event.requestId).sort()).toEqual(["req_active", "req_queued"])
    rmSync(dir, { recursive: true, force: true })
  })

  it("creates only allowlisted diagnostics fields", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hosted-worker-safe-log-"))
    mkdirSync(dir, { recursive: true })
    const diagnosticsPath = path.join(dir, "generate.jsonl")
    const state = createHostedWorkerRuntimeState()
    const queue = createHostedWorkerQueue(state)

    await generateHostedWorkerResponse(llmRequest("req_safe"), state, queue, {
      diagnosticsPath,
      clientFactory: () => ({
        generate: async () => ({
          rawText: "ok",
          displayEnvelope: createChatbotLlmDisplayEnvelope("ok"),
          tier: "tier-1-chrome-notion-ai",
          diagnostics: { endpoint: "/api/v3/runInferenceTranscript" },
        }),
      }),
    })

    const [event] = readJsonl(diagnosticsPath)
    expect(Object.keys(event).sort()).toEqual(
      [
        "aborted",
        "event",
        "generateDurationMs",
        "outcome",
        "pid",
        "queueWaitMs",
        "requestId",
        "timedOut",
        "timeoutMs",
        "uptimeMs",
      ].sort(),
    )
    expect(JSON.stringify(event)).not.toContain("systemPrompt")
    expect(JSON.stringify(event)).not.toContain("latestUserMessage")
    expect(JSON.stringify(event)).not.toContain("Bearer")
    rmSync(dir, { recursive: true, force: true })
  })
})
