import { describe, expect, it } from "vitest"

import {
  tier3FormFallbackCustomerText,
  tier3FormFallbackDefaults,
} from "@/lib/chatbot/server/llm-clients/tier3-form-fallback"

describe("tier 3 receipt copy", () => {
  it("describes the inquiry form rather than options the customer cannot see", () => {
    // Production conversation cmshqbzjy000604l7tpgj0gs5 rendered the inquiry form while the reply
    // still read "下の選択肢から選んでください", leaving the customer with nothing to choose.
    expect(tier3FormFallbackCustomerText).not.toContain("選択肢")
    expect(tier3FormFallbackCustomerText).toContain("フォーム")
  })

  it("keeps the client response wrapped in the customer display boundary", () => {
    expect(tier3FormFallbackDefaults.responseText).toBe(
      `<customer_reply>${tier3FormFallbackCustomerText}</customer_reply>`,
    )
  })
})
