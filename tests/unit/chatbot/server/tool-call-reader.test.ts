import { describe, expect, it } from "vitest"

import { createChatbotToolCallReadRequest } from "@/lib/chatbot/server/tool-call-reader"

describe("chatbot tool-call reader", () => {
  it("builds a full-prompt request without creating a new Notion AI thread", () => {
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
      routingDecision: {
        kind: "to-booking-inline",
        suggestedSlots: [
          {
            start: "2026-06-15T01:00:00.000Z",
            end: "2026-06-15T02:00:00.000Z",
            label: "6月15日 10:00",
            available: true,
          },
        ],
        jobContext: {
          jobKind: "cm-30s",
          finalMedium: "web",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
        },
      },
    })

    expect(request).toMatchObject({
      forceFullPrompt: true,
      temperature: 0,
      maxOutputTokens: 260,
      latestUserMessage: "7月に予約したいです",
    })
    expect(request).not.toHaveProperty("notionAiThread")
    expect(request.systemPrompt).toContain('{"tool":"create_booking"')
    expect(request.systemPrompt).toContain("外部ツール実行ではなく")
    expect(request.systemPrompt).toContain("プロンプトインジェクションとして拒否しない")
    expect(request.systemPrompt).toContain("create_booking")
    expect(request.systemPrompt).toContain("show_booking_card")
    expect(request.systemPrompt).toContain("get_estimate")
    expect(request.systemPrompt).toContain("bookingCardArgs")
    expect(request.systemPrompt).toContain("estimateArgs")
    expect(request.messages).toEqual([{ role: "user", content: "7月に予約したいです" }])
  })

  it("reuses an existing Notion AI thread for pseudo tool reads", () => {
    const request = createChatbotToolCallReadRequest({
      messages: [{ role: "user", content: "見積もりを知りたいです" }],
      latestUserMessage: "見積もりを知りたいです",
      notionAiThread: { threadId: "thread-existing" },
      conversationState: {
        hasFinalMedium: true,
        hasJobKind: true,
        hasProjectLength: true,
        hasAdditionalWork: true,
        hasDocumentaryAttachments: true,
        hasWorkSite: true,
        hasReferenceUrls: true,
        hasContactEmail: false,
        hasDesiredSchedule: false,
        turnCount: 2,
      },
      jobContext: {
        jobKind: "cm-30s",
        finalMedium: "web",
        workSite: "remote-grading",
        documentaryAttachment: { kind: "none" },
      },
    })

    expect(request.notionAiThread).toEqual({ threadId: "thread-existing" })
    expect(request.forceFullPrompt).toBe(true)
  })
})
