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
    conversationId: "conversation_test",
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

  it("fails closed instead of using a shared thread when conversation identity is missing", async () => {
    const state = createHostedWorkerRuntimeState()
    const queue = createHostedWorkerQueue(state)
    const request = llmRequest("req_missing_conversation")
    delete request.conversationId

    await expect(
      generateHostedWorkerResponse(request, state, queue, {
        clientFactory: () => ({
          generate: vi.fn(),
        }),
      }),
    ).rejects.toMatchObject({ code: "invalid-output", isRetryable: false })
  })

  it("allows a generation that completes within Tier1's 75-second attempt budget", async () => {
    vi.useFakeTimers()
    const state = createHostedWorkerRuntimeState()
    const queue = createHostedWorkerQueue(state)
    const response = generateHostedWorkerResponse(llmRequest("req_tier2_attempt_budget"), state, queue, {
      clientFactory: () => ({
        generate: () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  rawText: "completed before the Tier1 client deadline",
                  displayEnvelope: createChatbotLlmDisplayEnvelope("completed before the Tier1 client deadline"),
                  tier: "tier-1-hosted-chrome-notion-ai" as const,
                }),
              70_500,
            )
          }),
      }),
    })

    await vi.advanceTimersByTimeAsync(70_500)

    await expect(response).resolves.toMatchObject({
      rawText: "completed before the Tier1 client deadline",
      tier: "tier-1-hosted-chrome-notion-ai",
    })
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
                tier: "tier-1-hosted-chrome-notion-ai",
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
      tier: "tier-1-hosted-chrome-notion-ai",
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
                tier: "tier-1-hosted-chrome-notion-ai",
              })
          }),
      )
      .mockResolvedValue({
        rawText: "queued should not run",
        displayEnvelope: createChatbotLlmDisplayEnvelope("queued should not run"),
        tier: "tier-1-hosted-chrome-notion-ai",
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
          tier: "tier-1-hosted-chrome-notion-ai",
          diagnostics: { endpoint: "/api/v3/runInferenceTranscript" },
        }),
      }),
    })

    const [event] = readJsonl(diagnosticsPath)
    expect(Object.keys(event).sort()).toEqual(
      [
        "aborted",
        "boundary",
        "buildSha",
        "conversationScopeHash",
        "event",
        "generateDurationMs",
        "outcome",
        "pid",
        "queueSnapshots",
        "queueWaitMs",
        "requestId",
        "tier",
        "timedOut",
        "timeoutMs",
        "uptimeMs",
        "workerStartedAtEpochMs",
      ].sort(),
    )
    expect(JSON.stringify(event)).not.toContain("systemPrompt")
    expect(JSON.stringify(event)).not.toContain("latestUserMessage")
    expect(JSON.stringify(event)).not.toContain("conversation_test")
    expect(JSON.stringify(event)).not.toContain("Bearer")
    rmSync(dir, { recursive: true, force: true })
  })

  it("records queue and in-flight snapshots for a completed generation", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hosted-worker-queue-snapshots-"))
    const diagnosticsPath = path.join(dir, "generate.jsonl")
    const state = createHostedWorkerRuntimeState()
    const queue = createHostedWorkerQueue(state)

    await generateHostedWorkerResponse(llmRequest("req_queue_snapshots"), state, queue, {
      diagnosticsPath,
      clientFactory: () => ({
        generate: async () => ({
          rawText: "ok",
          displayEnvelope: createChatbotLlmDisplayEnvelope("ok"),
          tier: "tier-1-hosted-chrome-notion-ai",
        }),
      }),
    })

    const [event] = readJsonl(diagnosticsPath)
    expect(event.queueSnapshots).toEqual({
      enqueued: { inFlight: false, queueLength: 1 },
      started: { inFlight: true, queueLength: 0 },
      completed: { inFlight: false, queueLength: 0 },
    })
    expect(JSON.stringify(event.queueSnapshots)).not.toContain("system prompt")
    expect(JSON.stringify(event.queueSnapshots)).not.toContain("latest user message")
    rmSync(dir, { recursive: true, force: true })
  })

  it("records hidden-thread lifecycle diagnostics without a raw thread id or URL", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hosted-worker-thread-lifecycle-"))
    const diagnosticsPath = path.join(dir, "generate.jsonl")
    const state = createHostedWorkerRuntimeState()
    const queue = createHostedWorkerQueue(state)
    const rawThreadId = "aaaabbbbccccddddeeeeffff00001111"

    const response = await generateHostedWorkerResponse(llmRequest("req_hidden_thread"), state, queue, {
      diagnosticsPath,
      clientFactory: () => ({
        generate: async () => ({
          rawText: "ok",
          displayEnvelope: createChatbotLlmDisplayEnvelope("ok"),
          tier: "tier-1-hosted-chrome-notion-ai",
          diagnostics: {
            conversationThread: {
              mode: "reprovisioned",
              threadId: rawThreadId,
              threadVersion: 2,
              visibilityStatus: "hidden",
              alive: false,
              deletedAt: "2026-08-08T01:00:00.000Z",
              estimatedRetentionDeadline: "2026-09-07T01:00:00.000Z",
              hiddenFromChatList: true,
              hideAttemptCount: 1,
              hideVerificationResult: "verified",
              postHideInferenceVerified: true,
              threadRecordMissing: true,
              retentionPurgeDetected: true,
              threadReprovisioned: true,
              contextRebuiltFromHpDb: true,
            },
          },
        }),
      }),
    })

    expect(response.diagnostics?.conversationThread).toMatchObject({
      mode: "reprovisioned",
      threadIdHash: expect.stringMatching(/^[0-9a-f]{12}$/),
      threadVersion: 2,
      visibilityStatus: "hidden",
      alive: false,
      hiddenFromChatList: true,
      postHideInferenceVerified: true,
      retentionPurgeDetected: true,
      contextRebuiltFromHpDb: true,
    })
    const [event] = readJsonl(diagnosticsPath)
    expect(JSON.stringify(event)).not.toContain(rawThreadId)
    expect(JSON.stringify(event)).not.toContain("https://app.notion.com")
    rmSync(dir, { recursive: true, force: true })
  })

  it("records worker start and CDP session/target reuse state in the boundary event", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hosted-worker-runtime-state-"))
    const diagnosticsPath = path.join(dir, "generate.jsonl")
    const state = createHostedWorkerRuntimeState()
    const queue = createHostedWorkerQueue(state)

    await generateHostedWorkerResponse(llmRequest("req_runtime_state"), state, queue, {
      diagnosticsPath,
      clientFactory: () => ({
        generate: async () => ({
          rawText: "ok",
          displayEnvelope: createChatbotLlmDisplayEnvelope("ok"),
          tier: "tier-1-hosted-chrome-notion-ai",
          diagnostics: {
            cdpConnectionState: {
              session: "newly_established",
              target: "existing_reused",
            },
          },
        }),
      }),
    })

    const [event] = readJsonl(diagnosticsPath)
    expect(event).toMatchObject({
      event: "hosted_worker_generate",
      requestId: "req_runtime_state",
      workerStartedAtEpochMs: state.workerStartedAtEpochMs,
      cdpConnectionState: {
        session: "newly_established",
        target: "existing_reused",
      },
    })
    rmSync(dir, { recursive: true, force: true })
  })

  it("writes one request-correlated boundary record with all worker and hosted Notion AI stage spans", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hosted-worker-stage-timings-"))
    const diagnosticsPath = path.join(dir, "generate.jsonl")
    const state = createHostedWorkerRuntimeState()
    const queue = createHostedWorkerQueue(state)
    const hostedNotionAiStageTimings = {
      cdpTargetSession: {
        startedAtEpochMs: 1_000,
        completedAtEpochMs: 1_010,
        durationMs: 10,
      },
      runtimeContextPreparation: {
        startedAtEpochMs: 1_010,
        completedAtEpochMs: 1_025,
        durationMs: 15,
      },
      inferenceAttempts: [
        {
          attempt: 1,
          promptToFirstChunk: {
            startedAtEpochMs: 1_025,
            completedAtEpochMs: 1_125,
            durationMs: 100,
          },
          firstChunkToFinalChunk: {
            startedAtEpochMs: 1_125,
            completedAtEpochMs: 1_325,
            durationMs: 200,
          },
          ndjsonOutputContractValidation: {
            startedAtEpochMs: 1_325,
            completedAtEpochMs: 1_330,
            durationMs: 5,
          },
        },
      ],
    }

    const response = await generateHostedWorkerResponse(llmRequest("req_stage_timings"), state, queue, {
      diagnosticsPath,
      clientFactory: () => ({
        generate: async () => ({
          rawText: "ok",
          displayEnvelope: createChatbotLlmDisplayEnvelope("ok"),
          tier: "tier-1-hosted-chrome-notion-ai",
          diagnostics: { stageTimings: hostedNotionAiStageTimings },
        }),
      }),
    })

    const events = readJsonl(diagnosticsPath)
    expect(events).toHaveLength(1)
    expect.soft(response.diagnostics?.stageTimings).toMatchObject({
      workerQueueWait: {
        startedAtEpochMs: expect.any(Number),
        completedAtEpochMs: expect.any(Number),
        durationMs: expect.any(Number),
      },
      ...hostedNotionAiStageTimings,
    })
    expect.soft(events[0]).toMatchObject({
      event: "hosted_worker_generate",
      requestId: "req_stage_timings",
      tier: "tier-1-hosted-chrome-notion-ai",
      boundary: "hosted-notion-ai-stage-timings",
      stageTimings: {
        workerQueueWait: {
          startedAtEpochMs: expect.any(Number),
          completedAtEpochMs: expect.any(Number),
          durationMs: expect.any(Number),
        },
        ...hostedNotionAiStageTimings,
      },
    })
    expect(JSON.stringify(events[0])).not.toContain("system prompt")
    expect(JSON.stringify(events[0])).not.toContain("latest user message")
    rmSync(dir, { recursive: true, force: true })
  })
})
