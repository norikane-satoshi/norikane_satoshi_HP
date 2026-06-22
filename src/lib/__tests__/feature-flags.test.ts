import { afterEach, describe, expect, it, vi } from "vitest"
import { isBookingEnabled, isChatbotEnabled } from "@/lib/feature-flags"

describe("feature flags", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe("isBookingEnabled", () => {
    it("returns true only for the literal true string", () => {
      vi.stubEnv("NEXT_PUBLIC_ENABLE_BOOKING", "true")

      expect(isBookingEnabled()).toBe(true)
    })

    it("returns false for the literal false string", () => {
      vi.stubEnv("NEXT_PUBLIC_ENABLE_BOOKING", "false")

      expect(isBookingEnabled()).toBe(false)
    })

    it("returns false when unset", () => {
      delete process.env.NEXT_PUBLIC_ENABLE_BOOKING

      expect(isBookingEnabled()).toBe(false)
    })

    it.each(["1", "yes", "TRUE"])("returns false for invalid value %s", (value) => {
      process.env.NEXT_PUBLIC_ENABLE_BOOKING = value

      expect(isBookingEnabled()).toBe(false)
    })
  })

  describe("isChatbotEnabled", () => {
    it("returns true only for the literal true string", () => {
      vi.stubEnv("NEXT_PUBLIC_ENABLE_CHATBOT", "true")

      expect(isChatbotEnabled()).toBe(true)
    })

    it("returns false for the literal false string", () => {
      vi.stubEnv("NEXT_PUBLIC_ENABLE_CHATBOT", "false")

      expect(isChatbotEnabled()).toBe(false)
    })

    it("returns false when unset", () => {
      delete process.env.NEXT_PUBLIC_ENABLE_CHATBOT

      expect(isChatbotEnabled()).toBe(false)
    })

    it.each(["1", "yes", "TRUE"])("returns false for invalid value %s", (value) => {
      process.env.NEXT_PUBLIC_ENABLE_CHATBOT = value

      expect(isChatbotEnabled()).toBe(false)
    })
  })
})
