import type { ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"

export type NormalizedChatbotLlmResponse = {
  content: string
  role: "assistant"
  model: string
  finish_reason: "stop"
}

export const fallbackChatbotAssistantContent =
  "確認しました。案件内容を整理するため、最終媒体・尺・希望時期を教えてください。"

export function normalizeChatbotLlmResponse(
  response: ChatbotLlmResponse,
): NormalizedChatbotLlmResponse {
  return {
    content: sanitizeChatbotLlmText(response.rawText),
    role: "assistant",
    model: response.tier,
    finish_reason: "stop",
  }
}

export function sanitizeChatbotLlmText(rawText: string): string {
  const strippedThoughtBlocks = stripThinkBlocksOutsideCodeFences(rawText)
  const strippedLeadingThought = stripLeadingThoughtExplanation(strippedThoughtBlocks)
  const normalizedWhitespace = strippedLeadingThought.trim()

  return normalizedWhitespace.length > 0 ? normalizedWhitespace : fallbackChatbotAssistantContent
}

function stripThinkBlocksOutsideCodeFences(rawText: string): string {
  const withoutClosedBlocks = rawText.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
  const unclosedThinkIndex = withoutClosedBlocks.search(/<think\b[^>]*>/i)

  return unclosedThinkIndex === -1 ? withoutClosedBlocks : withoutClosedBlocks.slice(0, unclosedThinkIndex)
}

function stripLeadingThoughtExplanation(text: string): string {
  const withoutThoughtLabel = text.replace(
    /^\s*(?:思考|内部推論|推論|thinking|thought)\s*[:：]\s*[\s\S]{0,400}?(?:\n\s*\n|(?:回答|返信|返答|answer)\s*[:：]\s*)/iu,
    "",
  )

  return withoutThoughtLabel.replace(
    /^\s*(?:まず、?|最初に、?|はじめに、?)?(?:ユーザー|利用者|相談者|問い合わせ|メッセージ|依頼)(?:から|の)?[\s\S]{0,240}?(?:\n\s*\n|(?:回答|返信|返答)\s*[:：]\s*)/u,
    "",
  )
}
