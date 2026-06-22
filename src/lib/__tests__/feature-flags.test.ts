import { afterEach, describe, expect, it, vi } from "vitest"
import {
  isBookingEnabled,
  isBookingScheduleSectionVisible,
  isChatbotEnabled,
  isLocalBookingScheduleHost,
} from "@/lib/feature-flags"

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
    it("returns true for the literal true string", () => {
      vi.stubEnv("NEXT_PUBLIC_ENABLE_CHATBOT", "true")

      expect(isChatbotEnabled()).toBe(true)
    })

    it("returns false for the literal false string", () => {
      vi.stubEnv("NEXT_PUBLIC_ENABLE_CHATBOT", "false")

      expect(isChatbotEnabled()).toBe(false)
    })

    it("returns true when unset", () => {
      delete process.env.NEXT_PUBLIC_ENABLE_CHATBOT

      expect(isChatbotEnabled()).toBe(true)
    })

    it.each(["1", "yes", "TRUE"])("returns true for non-false value %s", (value) => {
      process.env.NEXT_PUBLIC_ENABLE_CHATBOT = value

      expect(isChatbotEnabled()).toBe(true)
    })
  })

  describe("isLocalBookingScheduleHost", () => {
    it.each(["localhost:41238", "127.0.0.1:41238", "[::1]:41238"])(
      "allows the local schedule host %s",
      (host) => {
        expect(isLocalBookingScheduleHost(host)).toBe(true)
      },
    )

    it.each(["localhost:3000", "norikane.studio", "preview-norikane.vercel.app", "localhost"])(
      "rejects non-41238 host %s",
      (host) => {
        expect(isLocalBookingScheduleHost(host)).toBe(false)
      },
    )
  })

  describe("isBookingScheduleSectionVisible", () => {
    it("shows the schedule on localhost:41238 without enabling all booking entrypoints", () => {
      delete process.env.NEXT_PUBLIC_ENABLE_BOOKING

      expect(isBookingEnabled()).toBe(false)
      expect(isBookingScheduleSectionVisible("localhost:41238")).toBe(true)
    })

    it("keeps production-like hosts hidden when the booking flag is unset", () => {
      delete process.env.NEXT_PUBLIC_ENABLE_BOOKING

      expect(isBookingScheduleSectionVisible("norikane.studio")).toBe(false)
      expect(isBookingScheduleSectionVisible("localhost:3000")).toBe(false)
    })

    it("preserves the explicit booking flag override", () => {
      vi.stubEnv("NEXT_PUBLIC_ENABLE_BOOKING", "true")

      expect(isBookingScheduleSectionVisible("norikane.studio")).toBe(true)
    })
  })
})
