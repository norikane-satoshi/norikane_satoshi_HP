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

  it("keeps nearby premise-based duration ranges so the LLM can adapt to context", () => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText: "ライブ2時間半規模の工程目安は通常7〜9日です。素材状況や追加作業で前後します。",
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

    expect(normalized.content).toContain("通常7〜9日")
    expect(normalized.content).toContain("素材状況や追加作業で前後")
  })

  it.each([
    ["作業期間は17～20日ほど見てください。"],
    ["工程: 17-20日で進められます。"],
    ["工程目安は17日から20日です。"],
    ["所要日数の目安は17〜20日です。"],
    ["スタジオの手配は、所要日数（17〜20日）を踏まえて相談します。"],
    ["ライブ2時間半のカラーグレーディングは、目安として17〜20日です。"],
  ])("suppresses clearly hallucinated workflow range notation: %s", (rawText) => {
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

  it("does not rewrite unrelated price, date, or headcount ranges", () => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText: "費用は17〜20万円では答えません。日程は7/17〜7/20が候補で、2〜3名体制です。工程目安は17〜20日です。",
        tier: "tier-3-ollama-deepseek",
      },
      {
        jobContext: {
          jobKind: "cm-30s",
          finalMedium: "web",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
          projectLengthMinutes: 0.5,
        },
      },
    )

    expect(normalized.content).toContain("費用は17〜20万円")
    expect(normalized.content).toContain("日程は7/17〜7/20")
    expect(normalized.content).toContain("2〜3名体制")
    expect(normalized.content).toContain("工程目安は1〜2日")
    expect(normalized.content).not.toContain("工程目安は17〜20日")
  })
})
