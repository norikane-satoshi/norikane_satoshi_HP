import { describe, expect, it } from "vitest"

import { shouldShowAdminReconnectBanner } from "@/components/booking/admin-reconnect-banner"

describe("shouldShowAdminReconnectBanner", () => {
  it("shows the banner for admin sessions when code is calendar_token_revoked", () => {
    expect(shouldShowAdminReconnectBanner(true, "calendar_token_revoked", false)).toBe(true)
  })

  it("hides the banner from non-admin sessions even when code is calendar_token_revoked", () => {
    expect(shouldShowAdminReconnectBanner(false, "calendar_token_revoked", false)).toBe(false)
  })

  it("hides the banner when code is null", () => {
    expect(shouldShowAdminReconnectBanner(true, null, false)).toBe(false)
  })

  it("hides the banner after the admin dismisses it", () => {
    expect(shouldShowAdminReconnectBanner(true, "calendar_token_revoked", true)).toBe(false)
  })

  it("hides the banner for other calendar surface codes such as calendar_token_not_connected", () => {
    expect(shouldShowAdminReconnectBanner(true, "calendar_token_not_connected", false)).toBe(false)
    expect(shouldShowAdminReconnectBanner(true, "calendar_oauth_env_missing", false)).toBe(false)
  })
})
