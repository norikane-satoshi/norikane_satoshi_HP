import { describe, expect, it } from "vitest"

import {
  normalizeChatbotLlmResponse,
  sanitizeChatbotLlmTextWithReport,
} from "@/lib/chatbot/server/llm-response-normalizer"
import {
  chatbotLeakCorpus,
  chatbotLeakCorpusFallbackText,
} from "../../../fixtures/chatbot/leak-corpus"

function customerReply(text: string): string {
  return `<customer_reply>${text}</customer_reply>`
}

describe("normalizeChatbotLlmResponse", () => {
  it.each(chatbotLeakCorpus)("matches the shared leak corpus: $id", (item) => {
    const result = sanitizeChatbotLlmTextWithReport(item.rawText, {
      routingDecision: {
        kind: "continue",
        nextQuestion: item.fallbackText ?? chatbotLeakCorpusFallbackText,
      },
    })

    expect(result.text).toBe(item.expected.text)
    expect(result.report.displayBoundary).toMatchObject({
      outcome: item.expected.outcome,
      fallbackApplied: item.expected.fallbackApplied,
    })
    expect(Boolean(result.report.unsafeArtifacts?.detected)).toBe(item.expected.unsafe)
  })

  it("keeps the cross-tier response contract stable", () => {
    expect(
      normalizeChatbotLlmResponse({
        rawText: customerReply("相談内容を確認しました。"),
        tier: "tier-3-ollama-deepseek",
      }),
    ).toEqual({
      content: "相談内容を確認しました。",
      role: "assistant",
      model: "tier-3-ollama-deepseek",
      finish_reason: "stop",
    })
  })

  it("falls back instead of exposing unmarked internal thinking signature blobs", () => {
    const opaqueBlob = "claude-sonnet-4-5-thinking-signature-" + "a".repeat(120)
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText: `I need to ask for a project name one by one. ${opaqueBlob} 承知しました。納品形式は特になし、として整理します。最後にもう1点だけ確認させてください。案件名を教えていただけますでしょうか？`,
        tier: "tier-2-hosted-chrome-notion-ai",
      },
      {
        routingDecision: {
          kind: "continue",
          nextQuestion: "案件名を教えていただけますでしょうか？",
        },
      },
    )

    expect(normalized.content).toBe("案件名を教えていただけますでしょうか？")
    expect(normalized.content).not.toContain("thinking")
    expect(normalized.content).not.toContain("claude-sonnet")
    expect(normalized.content).not.toMatch(/[A-Za-z0-9+/=_-]{80,}/u)
  })

  it("falls back instead of extracting readable first-person / user-narration monologue prepended to the reply", () => {
    // Real 41238 leak: readable English+Japanese internal monologue concatenated in
    // front of the customer reply, with no base64 / thinking-signature blob.
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText:
          'user said "特にないですー" (no particular preferences) regarding delivery format/distribution. I need to check what\'s still missing before show_booking_card. 案件名と担当者名が最も重要なので、まずこれらを聞こう。\n承りました。納品形式はお任せとして進めます。ほかに気になる点がなければ、作品名を教えていただけますか？',
        tier: "tier-1-chrome-notion-ai",
      },
      {
        routingDecision: {
          kind: "continue",
          nextQuestion: "作品名を教えていただけますか？",
        },
      },
    )

    expect(normalized.content).toBe("作品名を教えていただけますか？")
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
  ])("falls back on unmarked internal monologue variants: %s", (rawText, expected) => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText,
        tier: "tier-2-hosted-chrome-notion-ai",
      },
      {
        routingDecision: {
          kind: "continue",
          nextQuestion: expected,
        },
      },
    )

    expect(normalized.content).toBe(expected)
    expect(normalized.content).not.toMatch(/user\s+(?:said|selected)/i)
    expect(normalized.content).not.toContain("ユーザー")
    expect(normalized.content).not.toContain("show_booking_card")
    expect(normalized.content).not.toContain("projectTitle")
  })

  it.each([
    [
      "最も重要なのでまずこれらを聞こう\n承りました。作品名を教えていただけますか？",
      "承りました。作品名を教えていただけますか？",
    ],
    [
      "案件名と担当者名が最も重要なので、まずこれらを聞こう\n納品形式はお任せとして進めます。ほかに気になる点はありますか？",
      "納品形式はお任せとして進めます。ほかに気になる点はありますか？",
    ],
    [
      "先に案件種別を確認しよう\nまず案件の種類を教えていただけますか？",
      "まず案件の種類を教えていただけますか？",
    ],
    [
      "残りの必須項目を埋めるため、次は納品先を尋ねよう\n納品先はどちらになりますか？",
      "納品先はどちらになりますか？",
    ],
    [
      "候補日はあとで送ろう\nご希望の時期を教えていただけますか？",
      "ご希望の時期を教えていただけますか？",
    ],
  ])(
    "falls back on unmarked plain-form volitional monologue that ends a line without a trailing 句点",
    (rawText, expected) => {
      const normalized = normalizeChatbotLlmResponse(
        {
          rawText,
          tier: "tier-1-chrome-notion-ai",
        },
        {
          routingDecision: {
            kind: "continue",
            nextQuestion: expected,
          },
        },
      )

      expect(normalized.content).toBe(expected)
      expect(normalized.content).not.toMatch(/(?:聞こう|確認しよう|尋ねよう|送ろう)/u)
    },
  )

  it("keeps a polite suggestion (〜しましょう) and a thanks line intact", () => {
    const normalized = normalizeChatbotLlmResponse({
      rawText: customerReply(
        "ありがとうございます。まずは方向性を一緒に整理しましょう。ご希望の納期はいつ頃でしょうか？",
      ),
      tier: "tier-2-hosted-chrome-notion-ai",
    })

    expect(normalized.content).toBe(
      "ありがとうございます。まずは方向性を一緒に整理しましょう。ご希望の納期はいつ頃でしょうか？",
    )
  })

  it("keeps a legitimate reply that mentions Latin project terms and a URL", () => {
    const normalized = normalizeChatbotLlmResponse({
      rawText: customerReply(
        "Web CMのご相談、承りました。参考として https://norikane.studio/notes/color-grading もご覧いただけます。まず尺を教えてください。",
      ),
      tier: "tier-2-hosted-chrome-notion-ai",
    })

    expect(normalized.content).toBe(
      "Web CMのご相談、承りました。参考として https://norikane.studio/notes/color-grading もご覧いただけます。まず尺を教えてください。",
    )
  })

  it("falls back to the routing question when explicit display boundary is missing", () => {
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

  it("falls back to the routing question when the explicit display candidate contains opaque internal output", () => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText: customerReply(`thinking signature ${"A".repeat(140)}`),
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
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText: customerReply("まず尺を教えてください。\nalmond-croissant-low"),
        tier: "tier-2-hosted-chrome-notion-ai",
      },
      {
        routingDecision: {
          kind: "continue",
          nextQuestion: "まず尺を教えてください。",
        },
      },
    )

    expect(normalized.content).toBe("まず尺を教えてください。")
  })

  it("falls back instead of unwrapping internal language markup fragments", () => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText:
          "Web CM案件。次は尺を確認。<lang primary=\"Web CMのご相談、承りました。\nまず尺を教えてください。</lang>",
        tier: "tier-2-hosted-chrome-notion-ai",
      },
      {
        routingDecision: {
          kind: "continue",
          nextQuestion: "まず尺を教えてください。",
        },
      },
    )

    expect(normalized.content).toBe("まず尺を教えてください。")
    expect(normalized.content).not.toContain("<lang")
  })

  it("falls back when the explicit display candidate starts with a language prefix marker", () => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText: customerReply("ja-MVのカラーグレーディングですね。まず作品の尺を教えてください。"),
        tier: "tier-1-chrome-notion-ai",
      },
      {
        routingDecision: {
          kind: "continue",
          nextQuestion: "作品の尺を教えてください。",
        },
      },
    )

    expect(normalized.content).toBe("作品の尺を教えてください。")
    expect(normalized.content).not.toContain("ja-")
  })

  it("falls back when the explicit display candidate contains Japanese planning prose", () => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText: customerReply("MV案件の新規相談。まず尺を確認する必要がある。まず作品の尺を教えてください。"),
        tier: "tier-1-chrome-notion-ai",
      },
      {
        routingDecision: {
          kind: "continue",
          nextQuestion: "作品の尺を教えてください。",
        },
      },
    )

    expect(normalized.content).toBe("作品の尺を教えてください。")
    expect(normalized.content).not.toContain("必要がある")
  })

  it("keeps code fences inside an explicit customer reply", () => {
    const normalized = normalizeChatbotLlmResponse({
      rawText: customerReply("例として、以下の形で送れます。\n```text\n作品名: 未定\n```"),
      tier: "tier-2-hosted-chrome-notion-ai",
    })

    expect(normalized.content).toBe("例として、以下の形で送れます。\n```text\n作品名: 未定\n```")
  })

  it("keeps UI tool payloads inside an explicit customer reply", () => {
    const tool = '{"tool":"show_choice_panel","args":{"id":"final-medium","question":"公開先を教えてください","choices":[{"id":"web","label":"Web公開"},{"id":"broadcast","label":"放送"}]}}'
    const normalized = normalizeChatbotLlmResponse({
      rawText: customerReply(`公開先を確認します。\n${tool}`),
      tier: "tier-2-hosted-chrome-notion-ai",
    })

    expect(normalized.content).toContain("公開先を確認します。")
    expect(normalized.content).toContain('"tool":"show_choice_panel"')
  })

  it("reports the display boundary decision with request-safe fallback metadata", () => {
    const result = sanitizeChatbotLlmTextWithReport("最も重要なのでまずこれらを聞こう", {
      routingDecision: {
        kind: "continue",
        nextQuestion: "作品名を教えていただけますか？",
      },
    })

    expect(result.text).toBe("作品名を教えていただけますか？")
    expect(result.report.displayBoundary).toMatchObject({
      outcome: "fallback",
      source: "fallback-routing-question",
      defaultDenied: true,
      fallbackApplied: true,
      reasons: ["missing-explicit-display-boundary"],
    })
  })

  it("rejects unsafe server fallback text before final display", () => {
    const result = sanitizeChatbotLlmTextWithReport("<customer_reply>内容は受付済みなので同じ予約カードを再表示しません。</customer_reply>", {
      fallbackText: "補足を反映しました。必要な点を確認してから進めます。",
    })

    expect(result.text).toBe("内容を確認しました。続けて相談内容を送ってください。")
    expect(result.report.displayBoundary).toMatchObject({
      outcome: "fallback",
      fallbackApplied: true,
      reasons: expect.arrayContaining(["unsafe-display-candidate", "unsafe-fallback-text"]),
    })
    expect(result.report.unsafeArtifacts?.reasons).toEqual(expect.arrayContaining(["internal-booking-ui-state"]))
  })

  it("replaces overlarge live day ranges with the 150m anchor wording", () => {
    const normalized = normalizeChatbotLlmResponse(
      {
        rawText: customerReply("ライブ2.5時間規模ですと、**17〜20日程度**が通常のラインです。素材状況を確認します。"),
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
        rawText: customerReply(
          "ライブ2時間30分・DVD納品・顔ぼかし数カット込みでしたら、7〜8日程度が目安です。素材状況を確認します。",
        ),
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
        rawText: customerReply("ライブ2時間半規模の工程目安は通常7〜9日です。素材状況や追加作業で前後します。"),
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
        rawText: customerReply(rawText),
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
        rawText: customerReply("150分ライブの標準目安は7〜8日です。2時間半の場合は素材量を確認します。"),
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
        rawText: customerReply("費用は17〜20万円では答えません。日程は7/17〜7/20が候補で、2〜3名体制です。工程目安は17〜20日です。"),
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
