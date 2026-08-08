import { readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

describe("hosted Notion AI worker systemd template", () => {
  it("treats the worker's intentional SIGTERM exit as successful", async () => {
    const source = await readFile(
      path.join(process.cwd(), "scripts/chatbot/hosted-notion-ai-worker.service.template"),
      "utf8",
    )

    expect(source).toContain("EnvironmentFile=/home/chatbot-worker/.config/norikane-hosted-worker/worker.env")
    expect(source).toContain("SuccessExitStatus=143")
    expect(source).toContain("ExecStart=/home/chatbot-worker/norikane_satoshi_HP/node_modules/.bin/tsx scripts/chatbot/start-hosted-notion-ai-worker.ts")
  })
})
