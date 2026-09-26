// Runs once when a server instance starts, before it takes requests.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.TURSO_DATABASE_URL) return
  const { warmChatbotDatabase } = await import("@/lib/chatbot/server/database-warmup")
  // Not awaited: a slow or unreachable database must not hold the instance back from serving.
  void warmChatbotDatabase()
}
