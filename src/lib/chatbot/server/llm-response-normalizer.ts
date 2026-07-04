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

export type ChatbotLlmSanitizationReport = ChatbotDurationSafetyReport & {
  unsafeArtifacts?: {
    detected: true
    fallbackApplied: boolean
    reasons: Array<"opaque-token" | "thinking-signature-marker" | "internal-reasoning-line">
  }
}

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
  const unsafe = stripUnsafeCustomerFacingArtifacts(rawText)
  const fallbackText =
    unsafe.text ||
    (options.routingDecision?.kind === "continue"
      ? options.routingDecision.nextQuestion
      : "内容を確認しました。次に必要な情報を1つずつ確認します。")
  const durationResult = evaluateWorkflowDurationSafety(fallbackText, options)

  if (!unsafe.detected) return durationResult

  return {
    text: durationResult.text,
    report: {
      ...durationResult.report,
      unsafeArtifacts: {
        detected: true,
        fallbackApplied: unsafe.text.length === 0,
        reasons: unsafe.reasons,
      },
    },
  }
}

const opaqueTokenPattern = /(?:[A-Za-z0-9+/=_-]{80,})/gu
const thinkingSignatureMarkerPattern =
  /\b(?:thinking|signature|encrypted[_ -]?thinking|reasoning[_ -]?(?:content|signature)?|claude[-_\w]*sonnet)\b/iu
const internalReasoningLinePattern =
  /^\s*(?:i\s+(?:need|should|will|have to|must|think|can)|we\s+(?:need|should|will|have to|must|can)|let(?:'|’)s|the\s+(?:user|customer)\b|案件名を設けないといけない)/iu

function stripUnsafeCustomerFacingArtifacts(rawText: string): {
  text: string
  detected: boolean
  reasons: Array<"opaque-token" | "thinking-signature-marker" | "internal-reasoning-line">
} {
  const reasons = new Set<"opaque-token" | "thinking-signature-marker" | "internal-reasoning-line">()
  let text = rawText

  text = text
    .split(/\r?\n/u)
    .map((line) => {
      const opaqueMatches = [...line.matchAll(opaqueTokenPattern)]
      opaqueTokenPattern.lastIndex = 0
      const hasMarker = thinkingSignatureMarkerPattern.test(line)
      const looksInternal = internalReasoningLinePattern.test(line)

      if (opaqueMatches.length > 0) reasons.add("opaque-token")
      if (hasMarker) reasons.add("thinking-signature-marker")
      if (looksInternal) reasons.add("internal-reasoning-line")

      if (opaqueMatches.length > 0 && (hasMarker || looksInternal)) {
        const lastMatch = opaqueMatches.at(-1)
        const tailStart = (lastMatch?.index ?? 0) + (lastMatch?.[0].length ?? 0)
        return line.slice(tailStart)
      }
      if (hasMarker || looksInternal) return ""
      return line
    })
    .filter((line) => line.trim().length > 0)
    .join("\n")

  text = text.replace(opaqueTokenPattern, () => {
    reasons.add("opaque-token")
    return ""
  })

  if (thinkingSignatureMarkerPattern.test(text)) {
    reasons.add("thinking-signature-marker")
    text = text
      .split(/(?<=[。！？.!?])\s*/u)
      .filter((sentence) => !thinkingSignatureMarkerPattern.test(sentence))
      .join("")
  }

  return {
    text: text.replace(/\s{2,}/gu, " ").trim(),
    detected: reasons.size > 0,
    reasons: [...reasons],
  }
}
