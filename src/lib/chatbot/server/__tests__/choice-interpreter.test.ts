import { afterEach, describe, expect, it, vi } from "vitest"

import { additionalWorkChoices, finalMediumChoices, jobKindChoices } from "@/lib/chatbot/domain"
import { interpretChoiceWithJev } from "@/lib/chatbot/server/choice-interpreter"

function mockJev(answers: Record<string, unknown>, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers }), { status }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("interpretChoiceWithJev", () => {
  it("does nothing without an API key", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "")
    const fetchMock = mockJev({})
    await expect(interpretChoiceWithJev({ choiceSet: jobKindChoices, message: "MVです" })).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("adopts a confident single choice and sends only the question, options and a redacted answer", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key")
    const fetchMock = mockJev({ answer: { choice: "mv-5m", confidence: 0.93 } })
    await expect(
      interpretChoiceWithJev({ choiceSet: jobKindChoices, message: "ミュージックビデオです。連絡は a@example.com まで" }),
    ).resolves.toEqual({ choiceIds: ["mv-5m"] })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.state.customer_answer).not.toContain("a@example.com")
    expect(Object.keys(body.questions.answer.criteria)).not.toContain("other")
    expect(Object.keys(body.questions.answer.criteria)).toContain("not_an_answer")
  })

  it("abstains below the confidence threshold or on not_an_answer", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key")
    mockJev({ answer: { choice: "mv-5m", confidence: 0.6 } })
    await expect(interpretChoiceWithJev({ choiceSet: jobKindChoices, message: "たぶんMV" })).resolves.toBeNull()
    mockJev({ answer: { choice: "not_an_answer", confidence: 0.99 } })
    await expect(interpretChoiceWithJev({ choiceSet: jobKindChoices, message: "こんにちは" })).resolves.toBeNull()
  })

  it("collects confident options for multiple-selection panels", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key")
    mockJev({
      answer: { choice: "answers", confidence: 0.9 },
      includes_ott: { noul: 0.1 },
      includes_cinema: { noul: 0.05 },
      "includes_tv-broadcast": { noul: 0.02 },
      "includes_blu-ray": { noul: 0.01 },
      includes_youtube: { noul: 0.95 },
      includes_web: { noul: 0.8 },
      "includes_vertical-sns": { noul: 0.2 },
    })
    await expect(
      interpretChoiceWithJev({ choiceSet: finalMediumChoices, message: "YouTubeと自社サイトに載せます" }),
    ).resolves.toEqual({ choiceIds: ["youtube", "web"] })
  })

  it("does not combine none with concrete options", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key")
    mockJev({ answer: { choice: "answers", confidence: 0.9 }, includes_retouch: { noul: 0.9 }, includes_skin: { noul: 0.1 }, includes_none: { noul: 0.9 } })
    const choiceSet = {
      ...additionalWorkChoices,
      choices: [{ id: "retouch", label: "消し物" }, { id: "skin", label: "肌修正" }, { id: "none", label: "なし" }],
    }
    await expect(interpretChoiceWithJev({ choiceSet, message: "消し物はなしで" })).resolves.toBeNull()
  })

  it("returns null on HTTP errors and transport failures", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key")
    mockJev({}, 500)
    await expect(interpretChoiceWithJev({ choiceSet: jobKindChoices, message: "MVです" })).resolves.toBeNull()
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))
    await expect(interpretChoiceWithJev({ choiceSet: jobKindChoices, message: "MVです" })).resolves.toBeNull()
  })
})
