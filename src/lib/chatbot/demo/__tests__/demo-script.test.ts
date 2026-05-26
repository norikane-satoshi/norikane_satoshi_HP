import { describe, expect, it } from "vitest"

import { bookingOnboardingDemoScript } from "@/lib/chatbot/demo"

describe("bookingOnboardingDemoScript", () => {
  it("exports the required step kinds", () => {
    const kinds = new Set(bookingOnboardingDemoScript.steps.map((step) => step.kind))

    expect(kinds.has("move")).toBe(true)
    expect(kinds.has("annotate")).toBe(true)
    expect(kinds.has("complete")).toBe(true)
  })

  it("uses ratio-based targets", () => {
    const targetedSteps = bookingOnboardingDemoScript.steps.filter((step) => step.target)

    expect(targetedSteps.length).toBeGreaterThan(0)
    for (const step of targetedSteps) {
      expect(step.target?.xRatio).toBeGreaterThanOrEqual(0)
      expect(step.target?.xRatio).toBeLessThanOrEqual(1)
      expect(step.target?.yRatio).toBeGreaterThanOrEqual(0)
      expect(step.target?.yRatio).toBeLessThanOrEqual(1)
    }
  })

  it("keeps wording neutral", () => {
    const forbiddenTerms = ["お客様", "クライアント様", "さとしさん", "のりかね" + "さん"]
    const text = bookingOnboardingDemoScript.steps
      .flatMap((step) => [step.annotation?.title, step.annotation?.body])
      .filter(Boolean)
      .join("\n")

    for (const term of forbiddenTerms) {
      expect(text).not.toContain(term)
    }
  })

  it("does not describe an actual booking API action", () => {
    const text = bookingOnboardingDemoScript.steps
      .flatMap((step) => [step.annotation?.title, step.annotation?.body])
      .filter(Boolean)
      .join("\n")

    expect(text).toContain("ここでは実予約は行いません")
  })
})
