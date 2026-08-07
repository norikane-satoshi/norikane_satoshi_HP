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
const sharedThread = { spaceId: "space_1", userId: "user_1", threadId: "shared_thread_1" }

// All consultations share the worker's single Notion AI page thread. Persisting each turn kept
// growing that history until a reply quoted an unrelated customer's project
// (conversation cmsi5kb9m000004ky2tfrghsx).
describe("notion ai thread write-back", () => {
  it("stops persisting each consultation into the shared thread", () => {
    const payload = buildRunInferencePayload({ request: request(), runtimeContext: sharedThread, idFactory })

    expect(payload.saveAllThreadOperations).toBe(false)
  })

  it("leaves the rest of the request exactly as Notion accepts it", () => {
    const payload = buildRunInferencePayload({ request: request(), runtimeContext: sharedThread, idFactory })

    // A client-minted thread id, a full transcript, or a non-patch response each took Tier1 down
    // when they were tried (commits 48bae9c and 2d70278).
    expect(payload.threadId).toBe("shared_thread_1")
    expect(payload.createThread).toBe(false)
    expect(payload.isPartialTranscript).toBe(true)
    expect(payload.asPatchResponse).toBe(true)
  })
})
