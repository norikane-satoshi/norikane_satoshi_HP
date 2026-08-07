const defaultNotionAiChatbotThreadUrl =
  "https://www.notion.so/chat?t=3b513ee3141a80d5bd0200a92366e2b7"

export const notionAiChatbotThreadId = "3b513ee3-141a-80d5-bd02-00a92366e2b7"

export const notionAiChatbotThreadUrl = defaultNotionAiChatbotThreadUrl

export function getNotionAiChatbotThreadUrl(
  env: { NOTION_AI_CHATBOT_THREAD_URL?: string } = process.env as {
    NOTION_AI_CHATBOT_THREAD_URL?: string
  },
): string {
  const value = env.NOTION_AI_CHATBOT_THREAD_URL?.trim()
  return value || defaultNotionAiChatbotThreadUrl
}
