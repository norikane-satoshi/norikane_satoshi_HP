import type { ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"

export type NormalizedChatbotLlmResponse = {
  content: string
  role: "assistant"
  model: string
  finish_reason: "stop"
}

export function normalizeChatbotLlmResponse(
  response: ChatbotLlmResponse,
): NormalizedChatbotLlmResponse {
  return {
    content: response.rawText,
    role: "assistant",
    model: response.tier,
    finish_reason: "stop",
  }
}
