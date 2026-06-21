import type { JobContext, RoutingDecision } from "@/lib/chatbot/domain"
import {
  evaluateWorkflowDurationSafety,
  type ChatbotDurationSafetyReport,
} from "@/lib/chatbot/server/duration-safety"
import type { ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"

export type NormalizedChatbotLlmResponse = {
  content: string
  role: "assistant"
  model: string
  finish_reason: "stop"
}

export type ChatbotLlmSanitizationReport = ChatbotDurationSafetyReport

export function normalizeChatbotLlmResponse(
  response: ChatbotLlmResponse,
  options: { routingDecision?: RoutingDecision; jobContext?: JobContext } = {},
): NormalizedChatbotLlmResponse {
  return {
    content: sanitizeChatbotLlmText(response.rawText, options),
    role: "assistant",
    model: response.tier,
    finish_reason: "stop",
  }
}

export function sanitizeChatbotLlmText(
  rawText: string,
  options: { routingDecision?: RoutingDecision; jobContext?: JobContext } = {},
): string {
  return sanitizeChatbotLlmTextWithReport(rawText, options).text
}

export function sanitizeChatbotLlmTextWithReport(
  rawText: string,
  options: { routingDecision?: RoutingDecision; jobContext?: JobContext } = {},
): { text: string; report: ChatbotLlmSanitizationReport } {
  return evaluateWorkflowDurationSafety(rawText, options)
}
