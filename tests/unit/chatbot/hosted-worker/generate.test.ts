import { describe, expect, it, vi } from "vitest"

import {
  createHostedWorkerQueue,
  createHostedWorkerRuntimeState,
  generateHostedWorkerResponse,
} from "@/lib/chatbot/hosted-worker"
import { ChatbotLlmError, type ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"

function request(): ChatbotLlmRequest {
  return {
    systemPrompt: "Collect only new project intake details.",
    messages: [{ role: "user", content: "Web CM の相談です" }],
    latestUserMessage: "所要日数だけ確認したいです",
    conversationState: {
      hasFinalMedium: true,
      hasJobKind: true,
      hasProjectLength: true,
      hasAdditionalWork: true,
      hasDocumentaryAttachments: true,
      hasWorkSite: true,
      hasReferenceUrls: false,
      hasContactEmail: false,
      hasDesiredSchedule: false,
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

describe("generateHostedWorkerResponse", () => {
  it("serializes generation and normalizes the tier to hosted worker tier", async () => {
    const state = createHostedWorkerRuntimeState()
    const queue = createHostedWorkerQueue(state)
    const releaseFirst = createDeferred<void>()
    const calls: string[] = []
    const clientFactory = () => ({
      generate: vi.fn(async () => {
        calls.push("start")
        if (calls.length === 1) await releaseFirst.promise
        calls.push("finish")
        return {
          rawText: "回答しました",
          tier: "tier-1-chrome-notion-ai" as const,
          diagnostics: {
            endpoint: "/api/v3/runInferenceTranscript",
            attachTargetUrl: "https://www.notion.so/chat?t=secret-ish",
            chunkCount: 2,
          },
        }
      }),
    })

    const first = generateHostedWorkerResponse(request(), state, queue, { clientFactory })
    const second = generateHostedWorkerResponse(request(), state, queue, { clientFactory })
    await sleep(0)

    expect(state.queue.inFlight).toBe(true)
    expect(state.queue.queueLength).toBe(1)
    releaseFirst.resolve()

    await expect(first).resolves.toMatchObject({
      rawText: "回答しました",
      tier: "tier-2-hosted-chrome-notion-ai",
      diagnostics: {
        endpoint: "/api/v3/runInferenceTranscript",
        chunkCount: 2,
      },
    })
    await expect(second).resolves.toMatchObject({
      tier: "tier-2-hosted-chrome-notion-ai",
    })
    expect(calls).toEqual(["start", "finish", "start", "finish"])
    expect(state.queue.lastSuccessAt).toBeTruthy()
    expect(state.queue.lastErrorCode).toBeUndefined()
  })

  it("maps tier 1 errors to hosted worker errors and updates queue state", async () => {
    const state = createHostedWorkerRuntimeState()
    const queue = createHostedWorkerQueue(state)
    const clientFactory = () => ({
      generate: async () => {
        throw new ChatbotLlmError({
          message: "Notion AI page target is redirected to login.",
          code: "auth",
          tier: "tier-1-chrome-notion-ai",
          isRetryable: false,
        })
      },
    })

    await expect(
      generateHostedWorkerResponse(request(), state, queue, { clientFactory }),
    ).rejects.toMatchObject({
      code: "auth",
      tier: "tier-2-hosted-chrome-notion-ai",
      isRetryable: false,
    })
    expect(state.queue.lastErrorCode).toBe("auth")
  })
})

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
