import { describe, expect, it } from "vitest"

import en from "../../../messages/en.json"
import ja from "../../../messages/ja.json"
import { getLocalizedCopy } from "@/i18n/copy"
import { localizeSurveyChoiceSet } from "@/i18n/survey-choices"
import { finalMediumChoices } from "@/lib/chatbot/domain/survey-choice"
import { formatBookingDateSelection, formatDurationMinutes } from "@/lib/booking/domain/form-schema"

function objectPaths(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return [path, ...objectPaths(child, path)]
  })
}

describe("localized copy", () => {
  it("keeps matching translation keys in Japanese and English", () => {
    expect(objectPaths(en).sort()).toEqual(objectPaths(ja).sort())
  })

  it("selects English page and chatbot copy", () => {
    expect(getLocalizedCopy("en", "Booking").calendar).toBe("Booking calendar")
    expect(getLocalizedCopy("en", "Chatbot").initialMessage).toContain("project inquiries")
  })

  it("localizes canonical chatbot choice panels without changing stable ids", () => {
    const localized = localizeSurveyChoiceSet(finalMediumChoices, "en")
    expect(localized.id).toBe(finalMediumChoices.id)
    expect(localized.question).toBe("Select every final medium")
    expect(localized.choices.find((choice) => choice.id === "cinema")?.label).toBe("Theatrical release")
  })

  it("formats booking summaries for each locale", () => {
    const selection = { dates: ["2026-09-10", "2026-09-11"] }
    expect(formatBookingDateSelection(selection, "ja")).toContain("2日間")
    expect(formatBookingDateSelection(selection, "en")).toContain("2 day(s)")
    expect(formatDurationMinutes(90, "en")).toBe("1 hour(s) 30 min")
  })
})
