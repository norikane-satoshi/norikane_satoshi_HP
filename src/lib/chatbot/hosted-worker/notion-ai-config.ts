const defaultNotionAiChatbotThreadUrl =
  "https://www.notion.so/chat?t=36b13ee3141a8073885d00a99ebb676c"

export const notionAiChatbotThreadId = "36b13ee3-141a-8073-885d-00a99ebb676c"

export const notionAiChatbotThreadUrl = defaultNotionAiChatbotThreadUrl

export function getNotionAiChatbotThreadUrl(
  env: { NOTION_AI_CHATBOT_THREAD_URL?: string } = process.env as {
    NOTION_AI_CHATBOT_THREAD_URL?: string
  },
): string {
  const value = env.NOTION_AI_CHATBOT_THREAD_URL?.trim()
  return value || defaultNotionAiChatbotThreadUrl
}
