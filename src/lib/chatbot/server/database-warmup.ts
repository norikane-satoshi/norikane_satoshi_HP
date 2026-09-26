import { warmChatbotMessageRequestStore } from "./message-request-coordinator"
import { logPrivacySafeChatbotEvent } from "./boundary-event-log"

// A server instance's first customer message otherwise pays for starting the database client,
// opening its connection and running the claim queries for the first time (0.4-0.5 s in production).
export async function warmChatbotDatabase(): Promise<"warm" | "failed"> {
  try {
    await warmChatbotMessageRequestStore()
    return "warm"
  } catch (error) {
    logPrivacySafeChatbotEvent({
      event: "chatbot_database_warmup_failed",
      errorName: error instanceof Error ? error.name : typeof error,
    })
    return "failed"
  }
}
