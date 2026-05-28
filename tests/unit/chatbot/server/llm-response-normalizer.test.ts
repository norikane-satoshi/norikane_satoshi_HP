import { describe, expect, it } from "vitest"

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
        tier: "tier-2-ollama-deepseek",
      }),
    ).toEqual({
      content: "相談内容を確認しました。",
      role: "assistant",
      model: "tier-2-ollama-deepseek",
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
})
