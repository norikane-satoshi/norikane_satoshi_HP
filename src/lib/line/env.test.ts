import { afterEach, describe, expect, it, vi } from "vitest"
import { getLineBookingLiffUrl } from "./env"

describe("getLineBookingLiffUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("falls back to the current LINE LIFF URL when unset", () => {
    vi.stubEnv("NEXT_PUBLIC_LINE_LIFF_URL", undefined)

    expect(getLineBookingLiffUrl()).toBe("https://liff.line.me/2010558388-b4OhcjYE")
  })
})
