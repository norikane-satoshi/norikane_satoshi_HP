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

  it("removes internal thinking signature blobs before the customer-facing text", () => {
    const opaqueBlob = "claude-sonnet-4-5-thinking-signature-" + "a".repeat(120)
    const normalized = normalizeChatbotLlmResponse({
      rawText: `I need to ask for a project name one by one. ${opaqueBlob} 承知しました。納品形式は特になし、として整理します。最後にもう1点だけ確認させてください。案件名を教えていただけますでしょうか？`,
      tier: "tier-2-hosted-chrome-notion-ai",
    })

    expect(normalized.content).toBe(
      "承知しました。納品形式は特になし、として整理します。最後にもう1点だけ確認させてください。案件名を教えていただけますでしょうか？",
    )
    expect(normalized.content).not.toContain("thinking")
    expect(normalized.content).not.toContain("claude-sonnet")
    expect(normalized.content).not.toMatch(/[A-Za-z0-9+/=_-]{80,}/u)
  })

  it("falls back to the routing question when only opaque internal output remains", () => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText: `thinking signature ${"A".repeat(140)}`,
        tier: "tier-1-chrome-notion-ai",
      },
      {
        routingDecision: {
          kind: "continue",
          nextQuestion: "案件名を教えていただけますでしょうか？",
        },
      },
    )

    expect(normalized.content).toBe("案件名を教えていただけますでしょうか？")
  })

  it("removes trailing internal model codenames from customer-facing text", () => {
    const normalized = normalizeChatbotLlmResponse({
      rawText: "まず尺を教えてください。\nalmond-croissant-low",
      tier: "tier-2-hosted-chrome-notion-ai",
    })

    expect(normalized.content).toBe("まず尺を教えてください。")
  })

  it("unwraps internal language markup fragments", () => {
    const normalized = normalizeChatbotLlmResponse({
      rawText:
        "Web CM案件。次は尺を確認。<lang primary=\"Web CMのご相談、承りました。\nまず尺を教えてください。</lang>",
      tier: "tier-2-hosted-chrome-notion-ai",
    })

    expect(normalized.content).toBe("Web CMのご相談、承りました。\nまず尺を教えてください。")
  })

  it("replaces overlarge live day ranges with the 150m anchor wording", () => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText: "ライブ2.5時間規模ですと、**17〜20日程度**が通常のラインです。素材状況を確認します。",
        tier: "tier-3-ollama-deepseek",
      },
      {
        jobContext: {
          jobKind: "live-60m",
          finalMedium: "live",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
          projectLengthMinutes: 150,
          workflowEstimate: {
            stages: [],
            totalMinDays: 7,
            totalMaxDays: 8,
            riskFlags: [],
            estimateStatus: "authoritative",
          },
        },
      },
    )

    expect(normalized.content).toContain("ライブ2時間30分の基本目安は7〜8日程度")
    expect(normalized.content).toContain("顔ぼかしなどの追加作業やディスク納品の条件によっては")
    expect(normalized.content).not.toContain("17〜20日")
    expect(normalized.content).not.toContain("通常のラインです")
  })

  it("does not include face blur or delivery media in the 150m live baseline", () => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText:
          "ライブ2時間30分・DVD納品・顔ぼかし数カット込みでしたら、7〜8日程度が目安です。素材状況を確認します。",
        tier: "tier-2-hosted-chrome-notion-ai",
      },
      {
        jobContext: {
          jobKind: "live-60m",
          finalMedium: "live",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
          projectLengthMinutes: 150,
          workflowEstimate: {
            stages: [],
            totalMinDays: 7,
            totalMaxDays: 8,
            riskFlags: [],
            estimateStatus: "authoritative",
          },
        },
      },
    )

    expect(normalized.content).toContain("ライブ2時間30分の基本目安は7〜8日程度")
    expect(normalized.content).toContain("顔ぼかしなどの追加作業やディスク納品の条件によっては")
    expect(normalized.content).toContain("納品形式や追加作業量を確認します")
    expect(normalized.content).not.toContain("DVD")
    expect(normalized.content).not.toContain("顔ぼかし数カット込み")
    expect(normalized.content).not.toContain("納品込み")
  })

  it("does not keep invented nearby ranges for anchored live durations", () => {
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
          workflowEstimate: {
            stages: [],
            totalMinDays: 7,
            totalMaxDays: 8,
            riskFlags: [],
            estimateStatus: "authoritative",
          },
        },
      },
    )

    expect(normalized.content).toContain("ライブ2時間30分の基本目安は7〜8日程度")
    expect(normalized.content).not.toContain("通常7〜9日")
  })

  it.each([
    ["作業期間は17～20日ほど見てください。"],
    ["工程: 17-20日で進められます。"],
    ["工程目安は17日から20日です。"],
    ["所要日数の目安は17〜20日です。"],
    ["スタジオの手配は、所要日数（17〜20日）を踏まえて相談します。"],
    ["ライブ2時間半のカラーグレーディングは、目安として17〜20日です。"],
    ["ライブ2時間半は60分の2.5倍なので10日程度です。"],
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
          workflowEstimate: {
            stages: [],
            totalMinDays: 7,
            totalMaxDays: 8,
            riskFlags: [],
            estimateStatus: "authoritative",
          },
        },
      },
    )

    expect(normalized.content).toContain("7〜8日")
    expect(normalized.content).not.toMatch(/17(?:日から|[〜～-])20日/u)
    expect(normalized.content).not.toContain("10日程度")
  })

  it("keeps explicitly framed 150m live baselines", () => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText: "150分ライブの標準目安は7〜8日です。2時間半の場合は素材量を確認します。",
        tier: "tier-3-ollama-deepseek",
      },
      {
        jobContext: {
          jobKind: "live-60m",
          finalMedium: "live",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
          projectLengthMinutes: 150,
          workflowEstimate: {
            stages: [],
            totalMinDays: 7,
            totalMaxDays: 8,
            riskFlags: [],
            estimateStatus: "authoritative",
          },
        },
      },
    )

    expect(normalized.content).toBe("150分ライブの標準目安は7〜8日です。2時間半の場合は素材量を確認します。")
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
