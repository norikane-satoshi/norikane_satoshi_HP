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
    reasons: Array<
      | "opaque-token"
      | "thinking-signature-marker"
      | "internal-reasoning-line"
      | "internal-model-codename"
      | "internal-markup"
    >
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
  /^\s*(?:(?:the\s+)?(?:user|customer)\s+(?:said|says|answered|provided|asked|wants|needs)\b|i\s+(?:need|should|will|have to|must|think|can|have)\b|we\s+(?:need|should|will|have to|must|can)\b|let(?:'|’)s\b|(?:looking at|based on|from)\s+(?:the\s+)?(?:conversation|context)\b|案件名を設けないといけない|(?:案件名|作品名|担当者名).{0,40}(?:最も重要|聞こう|確認しよう))/iu
const internalReasoningFragmentPattern =
  /\b(?:show_booking_card|visible conversation|conversation context|what'?s still missing|next (?:i|we) (?:need|should|will|have to|must)|i need to|i should|we need to)\b/iu
const internalModelCodenamePattern =
  /\b[a-z][a-z0-9]*-[a-z][a-z0-9]*-(?:low|medium|high|fast|thinking|reasoning)\b/giu
const langPrimaryWrapperPattern = /<lang\s+primary=["']?/iu
const xmlLikeTagPattern = /<\/?[a-z][a-z0-9_-]*(?:\s+[^<>]*)?>/giu
const customerFacingStartPattern =
  /(?:承知(?:しました)?|承りました|ありがとうございます|ご相談ありがとうございます|内容を確認しました|確認しました|候補日を確認しました|まず[、\s]*(?:(?:案件名|作品名|担当者名|会社名|メールアドレス|納品形式|尺|公開先|作業場所|参考URL|追加作業).{0,32}(?:教えて|伺|確認|ください))|(?:案件名|作品名|担当者名|会社名|メールアドレス).{0,32}(?:教えて|伺|ください))/u

function stripUnsafeCustomerFacingArtifacts(rawText: string): {
  text: string
  detected: boolean
  reasons: Array<
    "opaque-token" | "thinking-signature-marker" | "internal-reasoning-line" | "internal-model-codename" | "internal-markup"
  >
} {
  const reasons = new Set<
    "opaque-token" | "thinking-signature-marker" | "internal-reasoning-line" | "internal-model-codename" | "internal-markup"
  >()
  let text = rawText
  const langPrimaryMatch = text.match(langPrimaryWrapperPattern)
  if (langPrimaryMatch?.index !== undefined) {
    reasons.add("internal-markup")
    text = text.slice(langPrimaryMatch.index + langPrimaryMatch[0].length)
  }

  text = text
    .split(/\r?\n/u)
    .map((line) => {
      const opaqueMatches = [...line.matchAll(opaqueTokenPattern)]
      opaqueTokenPattern.lastIndex = 0
      const hasMarker = thinkingSignatureMarkerPattern.test(line)
      const looksInternal = looksLikeInternalReasoning(line)

      if (opaqueMatches.length > 0) reasons.add("opaque-token")
      if (hasMarker) reasons.add("thinking-signature-marker")
      if (looksInternal) reasons.add("internal-reasoning-line")

      if (looksInternal) return stripInternalPrefix(line)
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
  text = text.replace(internalModelCodenamePattern, () => {
    reasons.add("internal-model-codename")
    return ""
  })
  text = text.replace(xmlLikeTagPattern, () => {
    reasons.add("internal-markup")
    return ""
  })

  if (thinkingSignatureMarkerPattern.test(text)) {
    reasons.add("thinking-signature-marker")
    text = text
      .split(/(?<=[。！？.!?])\s*/u)
      .filter((sentence) => !thinkingSignatureMarkerPattern.test(sentence))
      .join("")
  }

  if (looksLikeInternalReasoning(text)) {
    reasons.add("internal-reasoning-line")
    text = stripInternalPrefix(text)
  }

  return {
    text: text.replace(/\s{2,}/gu, " ").trim(),
    detected: reasons.size > 0,
    reasons: [...reasons],
  }
}

function looksLikeInternalReasoning(text: string): boolean {
  const normalized = text.replace(/\s+/gu, " ").trim()
  if (!normalized) return false
  return internalReasoningLinePattern.test(normalized) || internalReasoningFragmentPattern.test(normalized)
}

function stripInternalPrefix(text: string): string {
  const anchor = text.search(customerFacingStartPattern)
  if (anchor >= 0) return text.slice(anchor)
  return ""
}
