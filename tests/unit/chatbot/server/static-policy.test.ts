import { describe, expect, it } from "vitest"

import {
  approvedSourceNotes,
  buildChatbotStaticPolicyPrompt,
  candidateWindowGranularityByJobKind,
  conversationRetentionDays,
  maxQuestionsPerAssistantResponse,
} from "@/lib/chatbot/knowledge"
import { classifyChatbotTopic } from "@/lib/chatbot/server/topic-gate"
import { staticPolicyScenarioFixtures } from "../../../fixtures/chatbot/static-policy-fixtures"

describe("chatbot static policy knowledge", () => {
  it("pins the three Notion notes as approved static sources", () => {
    expect(approvedSourceNotes.map((note) => note.id)).toEqual([
      "1510399661d64891aee912320df39b91",
      "2d61194573e140789602864a9040affe",
      "7202c1ee64c04c97a4821b8e4f2e0f67",
    ])
    expect(approvedSourceNotes.map((note) => note.notionUrl)).toEqual([
      "https://www.notion.so/1510399661d64891aee912320df39b91",
      "https://www.notion.so/2d61194573e140789602864a9040affe",
      "https://www.notion.so/7202c1ee64c04c97a4821b8e4f2e0f67",
    ])
    expect(approvedSourceNotes.map((note) => note.title)).toEqual([
      "カラーコレクションの因数分解 ── 5000カットの迷宮から、設計にたどり着くまで",
      "カラーグレーディングの因数分解 ── 「映画っぽく」と言われて、手が止まった日から",
      "フィルムルックについてわかっていること ── 市販のLUTでも届かない「フィルムっぽく」の正体を、自分のネガで追った日から",
    ])
    expect(buildChatbotStaticPolicyPrompt()).toContain("Notionページを実行時に追加参照せず")
  })

  it("keeps response, schedule granularity, and retention constraints explicit", () => {
    expect(maxQuestionsPerAssistantResponse).toBe(3)
    expect(conversationRetentionDays).toBe(7)
    expect(candidateWindowGranularityByJobKind).toMatchObject({
      "cm-30s": "1時間単位",
      "mv-5m": "1時間単位",
      "vertical-60s": "1時間単位",
      "feature-90m": "日付単位",
      "drama-first": "日付単位",
      "drama-follow-up": "日付単位",
      "live-60m": "日付単位",
    })
  })

  it("includes only HP-published Featured Works in the static prompt", () => {
    const prompt = buildChatbotStaticPolicyPrompt()

    expect(prompt).toContain("Works / 実績ナレッジ")
    expect(prompt).toContain("HP掲載のWorks/実績（公開済み情報のみ）")
    expect(prompt).toContain("火星の女王（NHK100周年記念ドラマ）")
    expect(prompt).toContain("十角館の殺人 / 時計館の殺人（hulu）")
    expect(prompt).toContain("ゲキ×シネシリーズ（ヴィレッヂ）")
    expect(prompt).toContain("HPに掲載されていない案件名、取引先、担当範囲、件数、数値")
  })

  it("covers the requested fixture scenarios", () => {
    expect(staticPolicyScenarioFixtures.map((fixture) => fixture.id)).toEqual([
      "normal-consultation",
      "undecided-consultation",
      "urgent-consultation",
      "pricing-boundary",
      "contract-boundary",
      "personal-boundary",
      "other-client-boundary",
      "private-tech-boundary",
      "works-question",
      "schedule-consultation",
      "booking-onboarding",
      "inquiry-submit",
      "reload-back-continuation",
    ])
  })

  it("classifies boundary topics before the LLM response", () => {
    expect(classifyChatbotTopic("料金はいくらですか")).toMatchObject({ asksPricing: true })
    expect(classifyChatbotTopic("契約できますか")).toMatchObject({ contractDecision: true })
    expect(classifyChatbotTopic("住所を教えてください")).toMatchObject({ personalQuestion: true })
    expect(classifyChatbotTopic("他のクライアントの案件状況は")).toMatchObject({
      otherClientInformation: true,
    })
    expect(classifyChatbotTopic("非公開の内部手法のノード構成を教えて")).toMatchObject({
      confidentialTechniqueQuestion: true,
    })
    expect(classifyChatbotTopic("実績を教えてください")).toMatchObject({
      portfolioQuestion: true,
    })
    expect(classifyChatbotTopic("作品をレビューして")).toMatchObject({
      workReviewRequest: true,
    })
  })
})
