import { describe, expect, it } from "vitest"

import { bookingExternalWritesEnabled } from "@/lib/booking/server/external-write-policy"

const production = { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" }

describe("booking external write policy", () => {
  it("retains writes for deployed Production customer bookings", () => {
    expect(bookingExternalWritesEnabled(production)).toBe(true)
  })

  it.each([
    {},
    { ...production, NODE_ENV: "development" },
    { ...production, NODE_ENV: "test" },
    { ...production, VERCEL: undefined },
    { ...production, VERCEL_ENV: undefined },
    { ...production, VERCEL_ENV: "preview" },
    { ...production, BOOKING_EXTERNAL_WRITES: "disabled" },
    { ...production, VITEST: "true" },
  ])("denies local next dev/start, preview and verification despite inherited credentials: %j", (env) => {
    expect(bookingExternalWritesEnabled({
      GOOGLE_CALENDAR_BUSY_SOURCE_ID: "production-calendar",
      NOTION_TOKEN: "inherited-production-token",
      ...env,
    })).toBe(false)
  })
})
