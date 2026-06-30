import { describe, expect, it } from "vitest"

import { shouldRedirectUnauthenticated } from "@/components/booking/booking-client-shell"

describe("shouldRedirectUnauthenticated", () => {
  it("keeps the normal booking entry behind the web login redirect", () => {
    expect(shouldRedirectUnauthenticated(true, undefined, true)).toBe(true)
  })

  it("does not redirect before session loading has completed", () => {
    expect(shouldRedirectUnauthenticated(false, undefined, true)).toBe(false)
  })

  it("does not redirect when the LINE LIFF entry disables the normal web-auth redirect", () => {
    expect(shouldRedirectUnauthenticated(true, undefined, false)).toBe(false)
  })

  it("does not redirect an authenticated viewer", () => {
    expect(shouldRedirectUnauthenticated(true, "user_1", true)).toBe(false)
  })
})
