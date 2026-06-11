import { describe, expect, it } from "vitest"

import { additionalWorkChoices } from "@/lib/chatbot/domain"
import {
  fallbackChatbotAssistantContent,
  normalizeChatbotLlmResponse,
  sanitizeChatbotLlmText,
} from "@/lib/chatbot/server/llm-response-normalizer"

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

  it("removes closed think blocks", () => {
    expect(sanitizeChatbotLlmText("<think>内部推論です。</think>\n相談内容を確認しました。")).toBe(
      "相談内容を確認しました。",
    )
  })

  it("removes unclosed think blocks", () => {
    expect(sanitizeChatbotLlmText("冒頭です。\n<think>内部推論です。")).toBe("冒頭です。")
  })

  it("removes unclosed think blocks after closed think blocks", () => {
    expect(
      sanitizeChatbotLlmText("<think>先に消す推論。</think>\n本文です。\n<think>未閉じ推論です。"),
    ).toBe("本文です。")
  })

  it("keeps normal body text unchanged", () => {
    expect(sanitizeChatbotLlmText("Web CM の相談ですね。公開時期を教えてください。")).toBe(
      "Web CM の相談ですね。公開時期を教えてください。",
    )
  })

  it("uses the deterministic next question when continue routing presents choices", () => {
    expect(
      normalizeChatbotLlmResponse(
        {
          rawText: "打ち合わせや作業場所のご希望、連絡先を教えてください。",
          tier: "tier-3-ollama-deepseek",
        },
        {
          routingDecision: {
            kind: "continue",
            nextQuestion: "カラグレ以外の追加作業はありますか？",
            presentChoices: additionalWorkChoices,
          },
        },
      ).content,
    ).toBe("カラグレ以外の追加作業はありますか？")
  })

  it("keeps sanitized LLM text for continue routing without choices", () => {
    expect(
      sanitizeChatbotLlmText("<think>確認。</think>\n公開時期を教えてください。", {
        routingDecision: {
          kind: "continue",
          nextQuestion: "最終媒体は何になりますか？",
        },
      }),
    ).toBe("公開時期を教えてください。")
  })

  it("keeps only the body after a think block", () => {
    expect(sanitizeChatbotLlmText("<think>確認方針。</think>\n\n最終媒体と尺を教えてください。")).toBe(
      "最終媒体と尺を教えてください。",
    )
  })

  it("keeps think tags inside markdown code fences", () => {
    expect(
      sanitizeChatbotLlmText(
        "共有されたタグ例です。\n\n```html\n<think>タグ例</think>\n```\n\n必要な範囲だけ確認します。",
      ),
    ).toBe("共有されたタグ例です。\n\n```html\n<think>タグ例</think>\n```\n\n必要な範囲だけ確認します。")
  })

  it("uses fallback text when the whole response is a think block", () => {
    expect(sanitizeChatbotLlmText("<think>内部推論だけです。</think>")).toBe(fallbackChatbotAssistantContent)
  })

  it("removes leading thought labels before the answer body", () => {
    expect(
      sanitizeChatbotLlmText("思考: ユーザーの意図を整理する。\n\n最終媒体と公開時期を教えてください。"),
    ).toBe("最終媒体と公開時期を教えてください。")
  })

  it("limits assistant questions to three", () => {
    expect(
      sanitizeChatbotLlmText(
        "案件種類は何ですか？スケジュールは決まっていますか？お名前・会社名は何ですか？参考URLはありますか？",
      ),
    ).toBe("案件種類は何ですか？スケジュールは決まっていますか？お名前・会社名は何ですか？")
  })

  it("replaces price quotes with the direct-contact policy message", () => {
    expect(sanitizeChatbotLlmText("概算で10万円です。")).not.toMatch(/\d+万円/u)
    expect(sanitizeChatbotLlmText("概算で10万円です。")).toContain("のりかね本人")
  })

  it("does not expose private method names", () => {
    const privateMethodName = [["L", "OOK"].join(""), ["De", "composer"].join("")].join(" ")

    expect(sanitizeChatbotLlmText(`${privateMethodName} v2 の詳細はこうです。`)).not.toContain(
      privateMethodName,
    )
  })

  it("removes internal language tags and publicizes calendar wording", () => {
    expect(sanitizeChatbotLlmText('<lang primary="ja-JP"/>busy 時間帯を確認します。')).toBe(
      "予約が埋まっている時間帯を確認します。",
    )
  })

  it("uses schedule-first copy for booking-inline routing", () => {
    expect(
      sanitizeChatbotLlmText("カメラ種類を教えてください。", {
        routingDecision: {
          kind: "to-booking-inline",
          suggestedSlots: [],
          jobContext: {
            finalMedium: "web",
            workSite: "remote-grading",
            documentaryAttachment: { kind: "none" },
            workflowEstimate: { stages: [], totalMinDays: 7, totalMaxDays: 8, riskFlags: [] },
          },
        },
      }),
    ).toContain("作業目安は7〜8日")
  })

  it("keeps direct-contact routing override", () => {
    expect(
      sanitizeChatbotLlmText("公開時期を教えてください。", {
        routingDecision: {
          kind: "to-direct-contact",
          reason: "pricing",
          requireEmail: true,
          suggestedMessage: "メールアドレス、会社名、お名前を教えてください。",
        },
      }),
    ).toContain("のりかね本人")
  })
})
