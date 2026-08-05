import { afterEach, describe, expect, it, vi } from "vitest"

describe("getChatbotBuildInfo", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process")
    vi.unstubAllEnvs()
    vi.resetModules()
  })

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

  it("reads local git metadata once at module load and reuses the stable values", async () => {
    for (const key of [
      "CHATBOT_BUILD_SHA",
      "NEXT_PUBLIC_CHATBOT_BUILD_SHA",
      "VERCEL_GIT_COMMIT_SHA",
      "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
      "GIT_COMMIT_SHA",
      "CHATBOT_EXPECTED_REF",
      "NEXT_PUBLIC_CHATBOT_EXPECTED_REF",
      "VERCEL_GIT_COMMIT_REF",
      "NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF",
      "GIT_BRANCH",
    ]) {
      vi.stubEnv(key, "")
    }
    const execFileSync = vi.fn((_command: string, args: string[]) => (
      args[0] === "rev-parse" ? "stable-sha\n" : "staging\n"
    ))
    vi.doMock("node:child_process", () => ({ execFileSync }))
    vi.resetModules()

    const { getChatbotBuildInfo } = await import("./build-info")

    expect(getChatbotBuildInfo()).toMatchObject({
      commitSha: "stable-sha",
      expectedRef: "staging",
      commitShaSource: "git",
      expectedRefSource: "git",
    })
    expect(getChatbotBuildInfo()).toMatchObject({ commitSha: "stable-sha", expectedRef: "staging" })
    expect(execFileSync).toHaveBeenCalledTimes(2)
  })
})
