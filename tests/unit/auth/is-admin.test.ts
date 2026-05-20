import { afterEach, describe, expect, it, vi } from "vitest"

import { isAdmin } from "@/lib/auth/server/is-admin"

describe("isAdmin", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns true for the configured admin email", () => {
    vi.stubEnv("BOOKING_CALENDAR_ADMIN_EMAIL", "admin@example.com")

    expect(isAdmin("admin@example.com")).toBe(true)
  })

  it("returns true for uppercase variants", () => {
    vi.stubEnv("BOOKING_CALENDAR_ADMIN_EMAIL", "admin@example.com")

    expect(isAdmin("ADMIN@EXAMPLE.COM")).toBe(true)
  })

  it("returns true for values with surrounding spaces", () => {
    vi.stubEnv("BOOKING_CALENDAR_ADMIN_EMAIL", " admin@example.com ")

    expect(isAdmin("  admin@example.com  ")).toBe(true)
  })

  it("returns false for a different email", () => {
    vi.stubEnv("BOOKING_CALENDAR_ADMIN_EMAIL", "admin@example.com")

    expect(isAdmin("user@example.com")).toBe(false)
  })

  it("returns false for null", () => {
    vi.stubEnv("BOOKING_CALENDAR_ADMIN_EMAIL", "admin@example.com")

    expect(isAdmin(null)).toBe(false)
  })

  it("returns false for undefined", () => {
    vi.stubEnv("BOOKING_CALENDAR_ADMIN_EMAIL", "admin@example.com")

    expect(isAdmin(undefined)).toBe(false)
  })
})
