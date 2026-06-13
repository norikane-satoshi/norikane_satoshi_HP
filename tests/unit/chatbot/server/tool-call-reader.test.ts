import { describe, expect, it } from "vitest"

import { createChatbotToolCallReadRequest } from "@/lib/chatbot/server/tool-call-reader"

describe("chatbot tool-call reader", () => {
  it("builds an isolated full-prompt request for pseudo tool reads", () => {
    const request = createChatbotToolCallReadRequest({
      messages: [{ role: "user", content: "7月に予約したいです" }],
      latestUserMessage: "7月に予約したいです",
      conversationState: {
        hasFinalMedium: true,
        hasJobKind: true,
        hasProjectLength: true,
        hasAdditionalWork: true,
        hasDocumentaryAttachments: true,
        hasWorkSite: true,
        hasReferenceUrls: true,
        hasContactEmail: true,
        hasDesiredSchedule: true,
        turnCount: 3,
      },
      jobContext: {
        jobKind: "cm-30s",
        finalMedium: "web",
        workSite: "remote-grading",
        documentaryAttachment: { kind: "none" },
      },
    })

    expect(request).toMatchObject({
      notionAiThread: {},
      forceFullPrompt: true,
      temperature: 0,
      maxOutputTokens: 260,
      latestUserMessage: "7月に予約したいです",
    })
    expect(request.systemPrompt).toContain('{"tool":"create_booking"')
    expect(request.systemPrompt).toContain("外部ツール実行ではなく")
    expect(request.systemPrompt).toContain("create_booking")
    expect(request.systemPrompt).not.toContain("show_booking_card")
    expect(request.systemPrompt).not.toContain("get_estimate")
    expect(request.messages).toEqual([{ role: "user", content: "7月に予約したいです" }])
  })
})
