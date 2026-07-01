import { describe, expect, it } from "vitest"

import { shouldStartLineProviderSignIn } from "@/components/line/liff-booking-entry"

describe("shouldStartLineProviderSignIn", () => {
  it("starts the Auth.js LINE provider after LIFF is ready in the LINE client without an HP session", () => {
    expect(
      shouldStartLineProviderSignIn({
        authStarted: false,
        hpSessionLoaded: true,
        inClient: true,
        liffReady: true,
      }),
    ).toBe(true)
  })

  it("does not restart auth after the HP session exists or auth already started", () => {
    expect(
      shouldStartLineProviderSignIn({
        authStarted: false,
        hpSessionLoaded: true,
        inClient: true,
        liffReady: true,
        userId: "user_1",
      }),
    ).toBe(false)
    expect(
      shouldStartLineProviderSignIn({
        authStarted: true,
        hpSessionLoaded: true,
        inClient: true,
        liffReady: true,
      }),
    ).toBe(false)
  })

  it("does not start provider auth before LIFF and HP session checks are complete", () => {
    expect(
      shouldStartLineProviderSignIn({
        authStarted: false,
        hpSessionLoaded: false,
        inClient: true,
        liffReady: true,
      }),
    ).toBe(false)
    expect(
      shouldStartLineProviderSignIn({
        authStarted: false,
        hpSessionLoaded: true,
        inClient: false,
        liffReady: true,
      }),
    ).toBe(false)
  })
})
