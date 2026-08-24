import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

function ignorePatterns() {
  return new Set(
    readFileSync(".vercelignore", "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  )
}

describe("Vercel deploy input contract", () => {
  it("excludes local runtimes, generated artifacts, dependencies, and source media", () => {
    const patterns = ignorePatterns()

    const required = [
      ".codex-worktrees/",
      ".next/",
      "node_modules/",
      ".playwright/",
      "playwright-report/",
      "test-results/",
      "coverage/",
      "NHK講義動画/",
      "*.mp3",
      "*.wav",
      "*.mov",
      "*.mp4",
    ]
    expect(required.filter((pattern) => !patterns.has(pattern))).toEqual([])
  })
})
