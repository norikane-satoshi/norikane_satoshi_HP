import { describe, expect, it } from "vitest"

import { shouldStartLineProviderSignIn } from "@/components/line/liff-booking-entry"

describe("shouldStartLineProviderSignIn", () => {
  it("starts the Auth.js LINE provider after the LINE check settles without an HP session", () => {
    expect(
      shouldStartLineProviderSignIn({
        authStarted: false,
        hpSessionLoaded: true,
        lineCheckSettled: true,
      }),
    ).toBe(true)
  })

  it("does not restart auth after the HP session exists or auth already started", () => {
    expect(
      shouldStartLineProviderSignIn({
        authStarted: false,
        hpSessionLoaded: true,
        lineCheckSettled: true,
        userId: "user_1",
      }),
    ).toBe(false)
    expect(
      shouldStartLineProviderSignIn({
        authStarted: true,
        hpSessionLoaded: true,
        lineCheckSettled: true,
      }),
    ).toBe(false)
  })

  it("does not start provider auth before LIFF and HP session checks are complete", () => {
    expect(
      shouldStartLineProviderSignIn({
        authStarted: false,
        hpSessionLoaded: false,
        lineCheckSettled: true,
      }),
    ).toBe(false)
    expect(
      shouldStartLineProviderSignIn({
        authStarted: false,
        hpSessionLoaded: true,
        lineCheckSettled: false,
      }),
    ).toBe(false)
  })
})
