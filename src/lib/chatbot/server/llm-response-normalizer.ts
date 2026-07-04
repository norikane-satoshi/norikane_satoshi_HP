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
const internalModelCodenamePattern =
  /\b[a-z][a-z0-9]*-[a-z][a-z0-9]*-(?:low|medium|high|fast|thinking|reasoning)\b/giu
const langPrimaryWrapperPattern = /<lang\s+primary=["']?/iu
const xmlLikeTagPattern = /<\/?[a-z][a-z0-9_-]*(?:\s+[^<>]*)?>/giu

// The customer-facing reply is always Japanese, addressed to the user in polite
// register. Any segment that (a) narrates the user/conversation, (b) plans the
// assistant's own next action in first person or plain-form volitional, (c) names
// internal tools/fields/state, or (d) is English reasoning prose is internal
// monologue that must never reach the customer. These detectors classify segments
// structurally rather than matching one known leaked string, so novel monologue
// phrasings are caught by the same boundary.
const internalReasoningEnglishPattern =
  /\b(?:i|we)\s+(?:need|should|will|would|have|must|think|can|am|could|'ll|'m|'ve)\b|\blet(?:'|’)?s\b|\blet\s+(?:me|us)\b|\bi'?ll\b|\b(?:the\s+)?(?:user|customer)\s+(?:said|says|selected|asked|answered|chose|wants?|mentioned|indicated|responded|is|has|gave|provided|replied)\b|\blooking at the (?:conversation|context)\b|\bconfirmed facts?\b|\bwhat'?s\s+(?:still\s+)?missing\b|\bstill\s+missing\b|\bno particular preferences?\b|\bnow i\b/iu
const internalMachineIdentifierPattern =
  /\b(?:show_booking_card|show_choice_panel|projectTitle|contactName|contactEmail|companyName|dueDate|selectionMode|allowFreeText|choiceSetId|projectLengthMinutes|jobKind|finalMedium)\b/u
const japaneseInternalMonologuePattern =
  /ユーザー(?:は|が|さん|の|に)|(?:確定済み|未確定)\s*facts|メモリのルール|A項目|Aアイテム|必須の[A-Za-z]|(?:必要がある|べきだ|べきです|べきだろう|聞き返す|聞き返そう|進める条件|埋めるために|留めるべき|留める必要|チェックしている|確認している|把握している|判断している|提案する必要|勧めるべき|しないといけない|進めるべき|埋めるべき|確認する必要)|(?:聞こう|確認しよう|進めよう|提案しよう|勧めよう|埋めよう|しよう|返そう|尋ねよう|整理しよう|始めよう|まとめよう|決めよう|考えよう|見よう|出そう|送ろう|続けよう|把握しよう|質問しよう)(?:[。、]|\n|$)/u

// A segment is English reasoning prose when Latin words dominate over Japanese
// characters. Customer replies are Japanese, so a Latin-dominant segment is never
// a real reply, even without a known reasoning phrase.
function isEnglishReasoningProse(segment: string): boolean {
  const latinWords = (segment.match(/[A-Za-z][A-Za-z'’]+/gu) ?? []).length
  const japaneseChars = (segment.match(/[぀-ヿ㐀-鿿]/gu) ?? []).length
  if (japaneseChars === 0 && latinWords >= 2) return true
  return latinWords >= 4 && latinWords > japaneseChars
}

// Customer replies are always in polite register (です/ます/ください) or a direct
// question to the user. A substantive Japanese sentence that is in plain/dictionary
// form and is neither is the assistant thinking aloud about internal state, so it is
// dropped by register rather than by matching a specific leaked phrase. Plain-form
// volitional (意志形) endings — 聞こう / 話そう / 送ろう / 〜しよう / 〜よう — are the
// assistant planning its own next move; the polite customer form would be 〜しましょう,
// so a bare volitional ending at clause end (with or without a trailing 句点) is a leak.
// The godan volitional set requires a preceding kanji stem so greetings like ありがとう
// (hiragana が before とう) are not misread as monologue.
const politeRegisterPattern =
  /(?:です|でし|ます|まし|ませ|くださ|ましょ|でしょ|ございま|いたし|お願い|存じ|申し上げ|承り|伺い|頂け|いただけ)/u
const finitePlainPredicatePattern =
  /(?:ない|なかった|だ|である|いる|ている|てる|した|する|なる|べき|だろう|はず|ので|から|けど|けれど|だが|よう|しよう|[一-龠](?:こう|そう|とう|ろう|おう|もう|ぼう|ごう|のう|ぞう|どう|ぽう))[。、]?$/u
const listOrLabelPrefixPattern = /^[\s・\-*•:：<>\p{Pd}]/u
function isPlainFormJapaneseMonologue(segment: string): boolean {
  const trimmed = segment.trim()
  const japaneseChars = (trimmed.match(/[぀-ヿ㐀-鿹]/gu) ?? []).length
  if (japaneseChars < 6) return false
  if (politeRegisterPattern.test(trimmed)) return false
  if (/[?？]\s*$/u.test(trimmed)) return false
  if (listOrLabelPrefixPattern.test(trimmed)) return false
  return finitePlainPredicatePattern.test(trimmed)
}

function isInternalReasoningSegment(segment: string): boolean {
  const trimmed = segment.trim()
  if (trimmed.length === 0) return false
  return (
    internalReasoningEnglishPattern.test(trimmed) ||
    internalMachineIdentifierPattern.test(trimmed) ||
    japaneseInternalMonologuePattern.test(trimmed) ||
    isEnglishReasoningProse(trimmed) ||
    isPlainFormJapaneseMonologue(trimmed)
  )
}

// Drop internal-reasoning sentences while keeping any customer-facing sentence that
// shares the same line, so a leading monologue does not take the real reply with it.
function stripInternalReasoningSentences(line: string, reasons: Set<StripReason>): string {
  // Split on Japanese terminators and on an ASCII period that ends a sentence
  // (followed by whitespace or a Japanese character), so English monologue glued in
  // front of a Japanese reply separates. URLs and decimals have no space/CJK after
  // the dot, so they stay intact.
  const sentences = line.split(/(?<=[。！？!?])|(?<=\.)(?=\s|[぀-ヿ㐀-鿹])/u)
  let removed = false
  const kept = sentences.filter((sentence) => {
    if (sentence.trim().length === 0) return false
    if (isInternalReasoningSegment(sentence)) {
      removed = true
      return false
    }
    return true
  })
  if (removed) reasons.add("internal-reasoning-line")
  return kept.join("")
}

type StripReason =
  | "opaque-token"
  | "thinking-signature-marker"
  | "internal-reasoning-line"
  | "internal-model-codename"
  | "internal-markup"

function stripUnsafeCustomerFacingArtifacts(rawText: string): {
  text: string
  detected: boolean
  reasons: Array<StripReason>
} {
  const reasons = new Set<StripReason>()
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
      const looksInternal = isInternalReasoningSegment(line)

      if (opaqueMatches.length > 0) reasons.add("opaque-token")
      if (hasMarker) reasons.add("thinking-signature-marker")

      // When an opaque thinking blob sits between leading reasoning and a trailing
      // reply, keep only the text after the last blob (the blob carried the marker,
      // so what remains is stripped sentence-by-sentence below).
      if (opaqueMatches.length > 0 && (hasMarker || looksInternal)) {
        const lastMatch = opaqueMatches.at(-1)
        const tailStart = (lastMatch?.index ?? 0) + (lastMatch?.[0].length ?? 0)
        line = line.slice(tailStart)
      }
      return stripInternalReasoningSentences(line, reasons)
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

  return {
    text: text.replace(/\s{2,}/gu, " ").trim(),
    detected: reasons.size > 0,
    reasons: [...reasons],
  }
}
