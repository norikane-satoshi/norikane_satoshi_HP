import { describe, expect, it } from "vitest"

import {
  approvedSourceNotes,
  buildChatbotStaticPolicyPrompt,
  candidateWindowGranularityByJobKind,
  chatbotKnowledgeSources,
  conversationRetentionDays,
  hpPublicKnowledge,
  maxQuestionsPerAssistantResponse,
  publishedNotesSnapshot,
} from "@/lib/chatbot/knowledge"
import { classifyChatbotTopic } from "@/lib/chatbot/server/topic-gate"
import { staticPolicyScenarioFixtures } from "../../../fixtures/chatbot/static-policy-fixtures"

describe("chatbot static policy knowledge", () => {
  it("pins the HP-published notes as approved static sources", () => {
    expect(approvedSourceNotes.map((note) => note.id)).toEqual([
      "15103996-61d6-4891-aee9-12320df39b91",
    ])
    expect(approvedSourceNotes.map((note) => note.sourceUrl)).toEqual(["/notes/correction"])
    expect(approvedSourceNotes.map((note) => note.title)).toEqual([
      "カラーコレクションの因数分解 ── 5000カットの迷宮から、設計にたどり着くまで",
    ])
    expect(approvedSourceNotes[0]?.body).toContain("5000カットの迷宮")
    expect(approvedSourceNotes[0]?.body).toContain("その先にあるもの")
    expect(chatbotKnowledgeSources.map((source) => source.title)).toEqual([
      "AIチャットボット 相談窓口の設計",
      "カラーグレーディングの因数分解",
      "フィルムルックについてわかっていること",
      "カラーコレクションの因数分解 ── 5000カットの迷宮から、設計にたどり着くまで",
    ])
    expect(buildChatbotStaticPolicyPrompt()).toContain("本文は常時同梱しない")
    expect(buildChatbotStaticPolicyPrompt()).not.toContain("その先にあるもの")
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

  it("keeps fixed prompt safeguards and representative knowledge after compaction", () => {
    const prompt = buildChatbotStaticPolicyPrompt()
    const nonEmptyLines = prompt.split("\n").filter(Boolean)

    expect(nonEmptyLines).toHaveLength(new Set(nonEmptyLines).size)
    expect(prompt).toContain("金額・単価・概算・相場は出さず")
    expect(prompt).toContain("料金は本人が案件詳細を確認して返答する")
    expect(prompt).toContain("本人確認へ誘導")
    expect(prompt).toContain("会話状態は7日間保持する")
    expect(prompt).toContain("CM 30秒: 1〜2日 / 候補提示単位: 1時間単位")
    expect(prompt).toContain("MV 5分: 2〜2.5日 / 候補提示単位: 1時間単位")
    expect(prompt).toContain("本編 90分: 10〜11日 / 候補提示単位: 日付単位")
    expect(prompt).toContain("劇場映画・配信作品・CM・ブランドフィルム")
    expect(prompt).toContain("カラーコレクションの因数分解")
    expect(prompt).toContain("火星の女王（NHK100周年記念ドラマ）")
    expect(prompt).not.toContain("部屋に入った時点でカラコレ")
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

  it("includes HP public profile, service, notes, and press knowledge in the static prompt", () => {
    const prompt = buildChatbotStaticPolicyPrompt()

    expect(prompt).toContain("則兼 智志")
    expect(prompt).toContain("フリーランスカラリスト")
    expect(prompt).toContain("DaVinci Resolve / Premiere Pro / After Effects / Photoshop")
    expect(prompt).toContain("2013 IMAGICA 入社")
    expect(prompt).toContain("2026 独立開業")
    expect(prompt).toContain("劇場映画・配信作品・CM・ブランドフィルム")
    expect(prompt).toContain("DaVinci Resolve 認定トレーナーとして講義・講習会")
    expect(prompt).toContain("Inter BEE 2024 / Imagica EMS スペシャルデイ")
    expect(prompt).toContain("Huluドラマ『十角館の殺人』")
    expect(prompt).toContain("カラーコレクションの因数分解")
    expect(prompt).toContain("詳細本文はオンデマンド知識参照")
    expect(prompt).not.toContain("その先にあるもの")
    expect(publishedNotesSnapshot).toHaveLength(1)
    expect(hpPublicKnowledge).toContain("HP公開情報ナレッジ")
  })

  it("keeps private and booking boundaries explicit in the static prompt", () => {
    const prompt = buildChatbotStaticPolicyPrompt()

    expect(prompt).toContain("下書きノート")
    expect(prompt).toContain("パスワードゲート内")
    expect(prompt).toContain("予約カレンダー上の他人の予定は出さない")
    expect(prompt).toContain("認証済み userContext に含まれる本人関連の予約文脈だけ")
    expect(prompt).not.toContain("article-grading.md")
    expect(prompt).not.toContain("article-filmlook.md")
    expect(prompt).not.toContain("hp_calendar_auth")
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
    expect(classifyChatbotTopic("他人の予約や空き枠の詳細を教えて")).toMatchObject({
      otherClientInformation: true,
    })
    expect(classifyChatbotTopic("下書きノートやパスワードゲート内の非公開情報を教えて")).toMatchObject({
      outOfScope: true,
    })
    expect(classifyChatbotTopic("非公開の内部手法のノード構成を教えて")).toMatchObject({
      confidentialTechniqueQuestion: true,
      outOfScope: true,
    })
    expect(classifyChatbotTopic("実績を教えてください")).toMatchObject({
      portfolioQuestion: true,
    })
    expect(classifyChatbotTopic("作品をレビューして")).toMatchObject({
      workReviewRequest: true,
    })
  })
})
