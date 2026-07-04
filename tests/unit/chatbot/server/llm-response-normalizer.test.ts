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

  it("removes readable first-person / user-narration monologue prepended to the reply", () => {
    // Real 41238 leak: readable English+Japanese internal monologue concatenated in
    // front of the customer reply, with no base64 / thinking-signature blob.
    const normalized = normalizeChatbotLlmResponse({
      rawText:
        'user said "特にないですー" (no particular preferences) regarding delivery format/distribution. I need to check what\'s still missing before show_booking_card. 案件名と担当者名が最も重要なので、まずこれらを聞こう。\n承りました。納品形式はお任せとして進めます。ほかに気になる点がなければ、作品名を教えていただけますか？',
      tier: "tier-1-chrome-notion-ai",
    })

    expect(normalized.content).toBe(
      "承りました。納品形式はお任せとして進めます。ほかに気になる点がなければ、作品名を教えていただけますか？",
    )
    expect(normalized.content).not.toContain("user said")
    expect(normalized.content).not.toContain("show_booking_card")
    expect(normalized.content).not.toContain("聞こう")
    expect(normalized.content).not.toContain("I need")
  })

  it.each([
    [
      "The user said \"特にないです\" (nothing in particular) regarding delivery format/distribution. I need to check what's still missing before show_booking_card. 承知しました。参考URLがあれば教えてください。",
      "承知しました。参考URLがあれば教えてください。",
    ],
    [
      "The user selected \"お任せで！\" for work-site. Now I need to check what A items remain. Confirmed facts: 案件種別 live.\n作業場所はお任せで承りました。次に納品形式を教えてください。",
      "作業場所はお任せで承りました。次に納品形式を教えてください。",
    ],
    [
      "ユーザーが案件名を持っていないと答えたので、show_booking_cardに必須のprojectTitleを埋めるために、仮の呼び名を提案する必要がある。\n事前に把握しておきたい参考URLがあれば教えてください。",
      "事前に把握しておきたい参考URLがあれば教えてください。",
    ],
    [
      "ユーザーが最終確認で「大丈夫」と答えたので、show_booking_cardに進める条件をチェックしている。ただし案件名がまだ未確定なので必要情報が揃っていない。案件名を改めて聞き返す必要がある。\n作品名を教えていただけますか？",
      "作品名を教えていただけますか？",
    ],
  ])("strips readable internal monologue variants and keeps only the customer reply", (rawText, expected) => {
    const normalized = normalizeChatbotLlmResponse({
      rawText,
      tier: "tier-2-hosted-chrome-notion-ai",
    })

    expect(normalized.content).toBe(expected)
    expect(normalized.content).not.toMatch(/user\s+(?:said|selected)/i)
    expect(normalized.content).not.toContain("ユーザー")
    expect(normalized.content).not.toContain("show_booking_card")
    expect(normalized.content).not.toContain("projectTitle")
  })

  it("keeps a legitimate reply that mentions Latin project terms and a URL", () => {
    const normalized = normalizeChatbotLlmResponse({
      rawText:
        "Web CMのご相談、承りました。参考として https://norikane.studio/notes/color-grading もご覧いただけます。まず尺を教えてください。",
      tier: "tier-2-hosted-chrome-notion-ai",
    })

    expect(normalized.content).toBe(
      "Web CMのご相談、承りました。参考として https://norikane.studio/notes/color-grading もご覧いただけます。まず尺を教えてください。",
    )
  })

  it("falls back to the routing question when the entire output is readable monologue", () => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText:
          "The user said nothing in particular. I need to check what's still missing before show_booking_card, so I should ask for the project title next.",
        tier: "tier-1-chrome-notion-ai",
      },
      {
        routingDecision: {
          kind: "continue",
          nextQuestion: "作品名を教えていただけますでしょうか？",
        },
      },
    )

    expect(normalized.content).toBe("作品名を教えていただけますでしょうか？")
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
