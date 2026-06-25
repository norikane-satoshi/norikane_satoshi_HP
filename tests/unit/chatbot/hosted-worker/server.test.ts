import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { IncomingMessage, ServerResponse } from "node:http"

import { describe, expect, it, vi } from "vitest"

import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import { createHostedWorkerRequestHandler } from "@/lib/chatbot/hosted-worker/server"

function requestBody(): ChatbotLlmRequest {
  return {
    requestId: "req_server_abort",
    systemPrompt: "system",
    messages: [{ role: "user", content: "hello" }],
    latestUserMessage: "hello",
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

function postGenerateRequest(): IncomingMessage & PassThrough {
  const request = new PassThrough() as IncomingMessage & PassThrough
  request.method = "POST"
  request.url = "/generate"
  request.headers = { authorization: "Bearer test-token" }
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
  const response = new EventEmitter() as ServerResponse & EventEmitter & {
    body?: string
    headers: Record<string, string>
  } as FakeResponse
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

describe("hosted worker server", () => {
  it("propagates response close aborts to /generate", async () => {
    let generateSignal: AbortSignal | undefined
    const generate = vi.fn((_body, _state, _queue, options) => {
      generateSignal = options?.signal
      return new Promise<never>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      })
    })
    const handler = createHostedWorkerRequestHandler({
      token: "test-token",
      generate,
    })
    const request = postGenerateRequest()
    const response = fakeResponse()

    const handled = handler(request, response)
    request.end(JSON.stringify(requestBody()))
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce())
    expect(generateSignal?.aborted).toBe(false)

    ;(response as { destroyed: boolean }).destroyed = true
    response.emit("close")
    await handled

    expect(generateSignal?.aborted).toBe(true)
    expect(response.writableEnded).toBe(false)
  })
})
