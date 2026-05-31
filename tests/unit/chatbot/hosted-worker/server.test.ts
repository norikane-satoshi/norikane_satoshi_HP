import { afterEach, describe, expect, it } from "vitest"
import type { Server } from "node:http"

import {
  createHostedWorkerRuntimeState,
  createHostedWorkerServer,
} from "@/lib/chatbot/hosted-worker"
import type {
  HostedWorkerGenerateResponse,
  HostedWorkerHealthResponse,
} from "@/lib/chatbot/hosted-worker"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"

const token = "server-test-token"
const servers: Server[] = []

describe("hosted worker HTTP server", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer))
  })

  it("requires bearer auth for every endpoint", async () => {
    const baseUrl = await listen()

    const response = await fetch(`${baseUrl}/health`, {
      headers: { authorization: "Bearer wrong-token" },
    })

    await expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      tier: "tier-2-hosted-chrome-notion-ai",
      error: { code: "auth" },
    })
  })

  it("returns health with queue state and no secret echo", async () => {
    const state = createHostedWorkerRuntimeState()
    state.queue.lastErrorCode = "target_missing"
    const health = async (): Promise<HostedWorkerHealthResponse> => ({
      ok: false,
      status: "target_missing",
      action: "none",
      tier: "tier-2-hosted-chrome-notion-ai",
      cdp: { baseUrl: "http://127.0.0.1:9223", reachable: true },
      notionTarget: { found: false, loginRedirect: false, targetUrlMatches: false },
      preferredModel: { name: "apricot-sorbet-high" },
      queue: { ...state.queue },
      errorCode: "target_missing",
    })
    const baseUrl = await listen({ state, health })

    const response = await fetch(`${baseUrl}/health`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      tier: "tier-2-hosted-chrome-notion-ai",
      status: "target_missing",
      queue: { lastErrorCode: "target_missing" },
    })
    expect(JSON.stringify(body)).not.toContain(token)
  })

  it("serves /generate and preserves hosted worker tier", async () => {
    const generate = async (): Promise<HostedWorkerGenerateResponse> => ({
      rawText: "回答しました",
      tier: "tier-2-hosted-chrome-notion-ai",
      latencyMs: 12,
    })
    const baseUrl = await listen({ generate })

    const response = await fetch(`${baseUrl}/generate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(generateRequest()),
    })

    await expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      rawText: "回答しました",
      tier: "tier-2-hosted-chrome-notion-ai",
    })
  })

  it("rejects invalid /generate request bodies with field-level 400", async () => {
    const generate = async (): Promise<HostedWorkerGenerateResponse> => {
      throw new Error("generate should not be called")
    }
    const baseUrl = await listen({ generate })

    const response = await fetch(`${baseUrl}/generate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ latestUserMessage: "fake request" }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      tier: "tier-2-hosted-chrome-notion-ai",
      error: {
        code: "invalid-request",
        retryable: false,
        fields: expect.arrayContaining([
          { field: "systemPrompt", reason: "missing", expected: "string", received: "undefined" },
          { field: "messages", reason: "missing", expected: "array", received: "undefined" },
          { field: "conversationState", reason: "missing", expected: "object", received: "undefined" },
          { field: "jobContext", reason: "missing", expected: "object", received: "undefined" },
        ]),
      },
    })
  })
})

async function listen(options: Parameters<typeof createHostedWorkerServer>[0] = {}): Promise<string> {
  const server = createHostedWorkerServer({ token, ...options })
  servers.push(server)

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Unable to determine server address."))
        return
      }
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

function generateRequest(): ChatbotLlmRequest {
  return {
    systemPrompt: "Collect only new project intake details.",
    messages: [{ role: "user", content: "Web CM 30秒の相談です" }],
    latestUserMessage: "Web CM 30秒の相談です",
    conversationState: {
      hasFinalMedium: true,
      hasJobKind: true,
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

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
