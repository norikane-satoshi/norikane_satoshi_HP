import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const privacyRoutedFiles = [
  "src/lib/chatbot/server/message-handler.ts",
  "src/lib/chatbot/server/slack-notifier.ts",
  "src/app/api/chatbot/message/route.ts",
  "src/app/api/chatbot/create-booking-from-chat/route.ts",
  "src/lib/booking/server/create-booking.ts",
]

describe("chatbot operational log routing", () => {
  it.each(privacyRoutedFiles)("routes %s through the privacy-safe logger", (file) => {
    const source = readFileSync(file, "utf8")
    expect(source).not.toMatch(/console\.(?:info|warn|error|log)\s*\(/u)
  })
})
