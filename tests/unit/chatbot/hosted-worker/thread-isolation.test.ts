import { describe, expect, it } from "vitest"

import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import { buildRunInferencePayload } from "@/lib/chatbot/hosted-worker/notion-ai-browser-client"

function request(): ChatbotLlmRequest {
  return {
    systemPrompt: "相談窓口のシステムプロンプト",
    messages: [{ role: "user", content: "Web CM 30秒のカラーグレーディングをお願いしたいです" }],
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

// The worker drives one long-lived Notion AI page, so its runtime context always exposes the same
// thread. Reusing it made every customer's turns accumulate in a single shared thread, and a reply
// to one customer quoted another customer's project (conversation cmsi5kb9m000004ky2tfrghsx).
describe("notion ai thread isolation", () => {
  it("starts a fresh thread for every request even when the page already has one", () => {
    const shared = { spaceId: "space_1", userId: "user_1", threadId: "shared_thread_1" }

    const first = buildRunInferencePayload({ request: request(), runtimeContext: shared, idFactory })
    const second = buildRunInferencePayload({ request: request(), runtimeContext: shared, idFactory })

    expect(first.threadId).not.toBe("shared_thread_1")
    expect(second.threadId).not.toBe("shared_thread_1")
    expect(first.threadId).not.toBe(second.threadId)
    expect(first.createThread).toBe(true)
  })

  it("sends the whole transcript instead of leaning on thread history", () => {
    const payload = buildRunInferencePayload({
      request: request(),
      runtimeContext: { spaceId: "space_1", userId: "user_1", threadId: "shared_thread_1" },
      idFactory,
    })

    expect(payload.isPartialTranscript).toBe(false)
    expect(payload.asPatchResponse).toBe(false)
    const userStep = payload.transcript.find((step) => step.type === "user")
    expect(JSON.stringify(userStep)).toContain("Web CM 30秒")
  })

  it("does not persist customer transcripts into the workspace thread", () => {
    const payload = buildRunInferencePayload({
      request: request(),
      runtimeContext: { spaceId: "space_1", userId: "user_1", threadId: "shared_thread_1" },
      idFactory,
    })

    expect(payload.saveAllThreadOperations).toBe(false)
    expect(payload.setUnreadState).toBe(false)
  })
})
