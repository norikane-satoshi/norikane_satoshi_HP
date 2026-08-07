import { describe, expect, it } from "vitest"

import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import { buildRunInferencePayload } from "@/lib/chatbot/hosted-worker/notion-ai-browser-client"

function request(content: string): ChatbotLlmRequest {
  return {
    systemPrompt: "相談窓口のシステムプロンプト",
    messages: [{ role: "user", content }],
    conversationState: {
      hasFinalMedium: false,
      hasJobKind: false,
      hasAdditionalWork: false,
      hasDocumentaryAttachments: false,
      hasWorkSite: false,
      hasReferenceUrls: false,
      hasContactEmail: false,
      hasDesiredSchedule: false,
      turnCount: 1,
    },
    jobContext: { documentaryAttachment: { kind: "none" } } as ChatbotLlmRequest["jobContext"],
  }
}

let counter = 0
const idFactory = () => `id_${(counter += 1)}`
const sharedThread = { spaceId: "space_1", userId: "user_1", threadId: "shared_thread_1" }

// One shared Notion AI thread served every customer. A reply to a contract question quoted an
// unrelated customer's live project (conversation cmsi5kb9m000004ky2tfrghsx) because the request
// only sent the newest turn and let the shared thread supply the rest.
describe("shared notion ai thread history", () => {
  it("sends the whole conversation instead of leaning on the shared thread", () => {
    const payload = buildRunInferencePayload({
      request: request("Web CM 30秒のカラーグレーディングをお願いしたいです"),
      runtimeContext: sharedThread,
      idFactory,
    })

    expect(payload.isPartialTranscript).toBe(false)
    expect(JSON.stringify(payload.transcript.find((step) => step.type === "user"))).toContain("Web CM 30秒")
  })

  it("stops writing each consultation back into the shared thread", () => {
    const payload = buildRunInferencePayload({
      request: request("こんにちは"),
      runtimeContext: sharedThread,
      idFactory,
    })

    expect(payload.saveAllThreadOperations).toBe(false)
    expect(payload.setUnreadState).toBe(false)
  })

  it("keeps the page's own thread, which is the only id Notion accepts", () => {
    const payload = buildRunInferencePayload({
      request: request("こんにちは"),
      runtimeContext: sharedThread,
      idFactory,
    })

    expect(payload.threadId).toBe("shared_thread_1")
    expect(payload.createThread).toBe(false)
    expect(payload.asPatchResponse).toBe(true)
  })
})
