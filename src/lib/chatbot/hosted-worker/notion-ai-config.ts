// Notion persists every turn into this thread regardless of saveAllThreadOperations, so it grows
// until it hits Notion's storage limit and answers "Column size exceeded". Rotating it is a
// recurring operation, not a one-off: see docs/chatbot-notion-ai-thread-rotation.md.
const defaultNotionAiChatbotThreadUrl =
  "https://www.notion.so/chat?t=3b513ee3141a80d5bd0200a92366e2b7"

export function getNotionAiChatbotThreadUrl(
  env: { NOTION_AI_CHATBOT_THREAD_URL?: string } = process.env as {
    NOTION_AI_CHATBOT_THREAD_URL?: string
  },
): string {
  const value = env.NOTION_AI_CHATBOT_THREAD_URL?.trim()
  return value || defaultNotionAiChatbotThreadUrl
}
