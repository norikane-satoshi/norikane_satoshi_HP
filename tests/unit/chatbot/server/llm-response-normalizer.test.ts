import { describe, expect, it } from "vitest"

import { normalizeChatbotLlmResponse } from "@/lib/chatbot/server/llm-response-normalizer"

describe("normalizeChatbotLlmResponse", () => {
  it("keeps the cross-tier response contract stable", () => {
    expect(
      normalizeChatbotLlmResponse({
        rawText: "相談内容を確認しました。",
        tier: "tier-3-ollama-deepseek",
      }),
    ).toEqual({
      content: "相談内容を確認しました。",
      role: "assistant",
      model: "tier-3-ollama-deepseek",
      finish_reason: "stop",
    })
  })

  it("aligns live workflow day ranges to the deterministic estimate", () => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText: "ライブ2時間半規模の工程目安は17〜20日です。素材状況を確認します。",
        tier: "tier-3-ollama-deepseek",
      },
      {
        jobContext: {
          jobKind: "live-60m",
          finalMedium: "live",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
          projectLengthMinutes: 150,
        },
      },
    )

    expect(normalized.content).toContain("工程目安は7〜8日")
    expect(normalized.content).not.toContain("17〜20日")
  })

  it.each([
    ["作業期間は17～20日ほど見てください。"],
    ["工程: 17-20日で進められます。"],
    ["工程目安は17日から20日です。"],
  ])("aligns workflow range notation: %s", (rawText) => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText,
        tier: "tier-3-ollama-deepseek",
      },
      {
        jobContext: {
          jobKind: "live-60m",
          finalMedium: "live",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
          projectLengthMinutes: 150,
        },
      },
    )

    expect(normalized.content).toContain("7〜8日")
    expect(normalized.content).not.toMatch(/17(?:日から|[〜～-])20日/u)
  })
})
