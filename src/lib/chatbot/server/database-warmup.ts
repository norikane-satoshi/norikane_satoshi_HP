import { prisma } from "@/lib/prisma"

import { logPrivacySafeChatbotEvent } from "./boundary-event-log"

// A new server instance otherwise pays for starting the database client and opening its connection
// (about 0.7 s in production) inside the first customer message it handles.
export async function warmChatbotDatabase(): Promise<"warm" | "failed"> {
  const startedAt = Date.now()
  try {
    await prisma.$queryRawUnsafe("SELECT 1")
    await prisma.chatbotConversation.findUnique({ where: { id: "__warmup__" }, select: { id: true } })
    logPrivacySafeChatbotEvent({ event: "chatbot_database_warmed", durationMs: Date.now() - startedAt })
    return "warm"
  } catch (error) {
    logPrivacySafeChatbotEvent({
      event: "chatbot_database_warmup_failed",
      errorName: error instanceof Error ? error.name : typeof error,
    })
    return "failed"
  }
}
