import { describe, expect, it } from "vitest"

import {
  approvedSourceNotes,
  buildChatbotStaticPolicyPrompt,
  candidateWindowGranularityByJobKind,
  conversationRetentionHours,
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
    expect(buildChatbotStaticPolicyPrompt()).toContain("Notionページを実行時にRAG参照せず")
  })

  it("keeps response, schedule granularity, and retention constraints explicit", () => {
    expect(maxQuestionsPerAssistantResponse).toBe(3)
    expect(conversationRetentionHours).toBe(24)
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
    expect(classifyChatbotTopic("LOOK Decomposer v2 のノード構成を教えて")).toMatchObject({
      privateMethodNameExposure: true,
      lookDecomposerDetail: true,
    })
  })
})
