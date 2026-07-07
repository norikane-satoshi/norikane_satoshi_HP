import { describe, expect, it, vi } from "vitest"

describe("getChatbotBuildInfo", () => {
  it("prefers build env metadata when present", async () => {
    vi.stubEnv("CHATBOT_BUILD_SHA", "abc123")
    vi.stubEnv("CHATBOT_EXPECTED_REF", "origin/staging")
    vi.stubEnv("CHATBOT_BUILD_TIME", "2026-07-05T00:00:00.000Z")
    vi.resetModules()

    const { getChatbotBuildInfo } = await import("./build-info")

    expect(getChatbotBuildInfo()).toMatchObject({
      commitSha: "abc123",
      expectedRef: "origin/staging",
      buildTime: "2026-07-05T00:00:00.000Z",
      commitShaSource: "env",
      expectedRefSource: "env",
    })
  })
})
