import type { JobContext, RoutingDecision } from "@/lib/chatbot/domain"
import {
  evaluateWorkflowDurationSafety,
  type ChatbotDurationSafetyReport,
} from "@/lib/chatbot/server/duration-safety"
import type { ChatbotLlmDisplayEnvelope, ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"

export type NormalizedChatbotLlmResponse = {
  content: string
  role: "assistant"
  model: string
  finish_reason: "stop"
}

export type ChatbotLlmSanitizationReport = ChatbotDurationSafetyReport & {
  displayBoundary: {
    outcome: "adopted" | "fallback"
    source:
      | "customer-reply-tag"
      | "json-customer-reply"
      | "trusted-server-display"
      | "fallback-routing-question"
      | "fallback-safe-clarification"
    defaultDenied: boolean
    fallbackApplied: boolean
    reasons: Array<
      | "missing-explicit-display-boundary"
      | "empty-display-text"
      | "unsafe-display-candidate"
      | "trusted-server-display"
    >
  }
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
  response: Pick<ChatbotLlmResponse, "rawText" | "tier"> & Partial<Pick<ChatbotLlmResponse, "displayEnvelope">>,
  options: { routingDecision?: RoutingDecision; jobContext?: JobContext; trustedDisplayText?: boolean } = {},
): NormalizedChatbotLlmResponse {
  return {
    content: sanitizeChatbotLlmText(response.rawText, {
      ...options,
      displayEnvelope: response.displayEnvelope ?? createChatbotLlmDisplayEnvelope(response.rawText),
    }),
    role: "assistant",
    model: response.tier,
    finish_reason: "stop",
  }
}

export function sanitizeChatbotLlmText(
  rawText: string,
  options: {
    routingDecision?: RoutingDecision
    jobContext?: JobContext
    trustedDisplayText?: boolean
    displayEnvelope?: ChatbotLlmDisplayEnvelope
  } = {},
): string {
  return sanitizeChatbotLlmTextWithReport(rawText, options).text
}

export function sanitizeChatbotLlmTextWithReport(
  rawText: string,
  options: {
    routingDecision?: RoutingDecision
    jobContext?: JobContext
    trustedDisplayText?: boolean
    displayEnvelope?: ChatbotLlmDisplayEnvelope
  } = {},
): { text: string; report: ChatbotLlmSanitizationReport } {
  const fallbackText =
    options.routingDecision?.kind === "continue"
      ? options.routingDecision.nextQuestion
      : "内容を確認しました。次に必要な情報を1つずつ確認します。"
  const extraction = toDisplayBoundaryExtraction(
    options.displayEnvelope ??
      (options.trustedDisplayText
        ? createTrustedChatbotLlmDisplayEnvelope(rawText)
        : createChatbotLlmDisplayEnvelope(rawText)),
  )
  const unsafe = extraction.text ? detectUnsafeCustomerFacingArtifacts(extraction.text) : noUnsafeArtifacts()
  const useFallback = !extraction.text || unsafe.detected
  const displayText = useFallback ? fallbackText : extraction.text
  const durationResult = evaluateWorkflowDurationSafety(displayText, options)
  const report: ChatbotLlmSanitizationReport = {
    ...durationResult.report,
    displayBoundary: {
      outcome: useFallback ? "fallback" : "adopted",
      source: useFallback
        ? options.routingDecision?.kind === "continue"
          ? "fallback-routing-question"
          : "fallback-safe-clarification"
        : extraction.source,
      defaultDenied: extraction.defaultDenied || useFallback,
      fallbackApplied: useFallback,
      reasons: [
        ...extraction.reasons,
        ...(unsafe.detected ? (["unsafe-display-candidate"] as const) : []),
      ],
    },
  }

  if (unsafe.detected) {
    report.unsafeArtifacts = {
        detected: true,
        fallbackApplied: useFallback,
        reasons: unsafe.reasons,
    }
  }

  return { text: durationResult.text, report }
}

export function createChatbotLlmDisplayEnvelope(rawText: string): ChatbotLlmDisplayEnvelope {
  return extractExplicitCustomerDisplayText(rawText)
}

export function createTrustedChatbotLlmDisplayEnvelope(rawText: string): ChatbotLlmDisplayEnvelope {
  return {
    text: rawText.trim(),
    source: "trusted-server-display",
    defaultDenied: false,
    fallbackApplied: false,
    reasons: ["trusted-server-display"],
  }
}

const opaqueTokenPattern = /(?:[A-Za-z0-9+/=_-]{80,})/gu
const thinkingSignatureMarkerPattern =
  /\b(?:thinking|signature|encrypted[_ -]?thinking|reasoning[_ -]?(?:content|signature)?|claude[-_\w]*sonnet)\b/iu
const internalModelCodenamePattern =
  /\b[a-z][a-z0-9]*-[a-z][a-z0-9]*-(?:low|medium|high|fast|thinking|reasoning)\b/giu
const langPrimaryWrapperPattern = /<lang\s+primary=["']?/iu
const languagePrefixMarkerPattern = /^\s*(?:ja|jp|japanese|日本語)\s*[-_:：]/iu
const xmlLikeTagPattern = /<\/?[a-z][a-z0-9_-]*(?:\s+[^<>]*)?>/giu

// These detectors are an auxiliary validation net for the explicit display
// candidate. They never rewrite text in place; a candidate that trips them is
// rejected as a whole and the caller falls back to a server-authored safe reply.
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

type StripReason =
  | "opaque-token"
  | "thinking-signature-marker"
  | "internal-reasoning-line"
  | "internal-model-codename"
  | "internal-markup"

type DisplayBoundaryExtraction = ChatbotLlmDisplayEnvelope

function toDisplayBoundaryExtraction(envelope: ChatbotLlmDisplayEnvelope): DisplayBoundaryExtraction {
  return envelope
}

function extractExplicitCustomerDisplayText(rawText: string): DisplayBoundaryExtraction {
  const tagged = extractCustomerReplyTag(rawText)
  if (tagged !== undefined) {
    return {
      text: tagged,
      source: "customer-reply-tag",
      defaultDenied: false,
      fallbackApplied: false,
      reasons: tagged ? [] : ["empty-display-text"],
    }
  }

  const jsonField = extractCustomerReplyJsonField(rawText)
  if (jsonField !== undefined) {
    return {
      text: jsonField,
      source: "json-customer-reply",
      defaultDenied: false,
      fallbackApplied: false,
      reasons: jsonField ? [] : ["empty-display-text"],
    }
  }

  return {
    text: "",
    source: "customer-reply-tag",
    defaultDenied: true,
    fallbackApplied: true,
    reasons: ["missing-explicit-display-boundary"],
  }
}

function extractCustomerReplyTag(rawText: string): string | undefined {
  const match = /<customer_reply>\s*([\s\S]*?)\s*<\/customer_reply>/iu.exec(rawText)
  return match ? normalizeDisplayText(match[1] ?? "") : undefined
}

function extractCustomerReplyJsonField(rawText: string): string | undefined {
  for (const candidate of extractJsonObjectCandidates(rawText)) {
    const parsed = parseJson(candidate)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue
    const record = parsed as Record<string, unknown>
    const value = record.customer_reply ?? record.customerReply ?? record.display_text ?? record.displayText
    if (typeof value === "string") return normalizeDisplayText(value)
  }
  return undefined
}

function extractJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = []
  const fencedPattern = /```(?:json)?\s*([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  while ((match = fencedPattern.exec(text))) {
    const body = match[1]?.trim()
    if (body?.startsWith("{") && body.endsWith("}")) candidates.push(body)
  }

  const trimmed = text.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) candidates.push(trimmed)

  const firstBrace = text.indexOf("{")
  const lastBrace = text.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1))
  }
  return [...new Set(candidates)]
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function noUnsafeArtifacts(): { detected: false; reasons: [] } {
  return { detected: false, reasons: [] }
}

function detectUnsafeCustomerFacingArtifacts(rawText: string): {
  detected: boolean
  reasons: Array<StripReason>
} {
  const reasons = new Set<StripReason>()
  const textForAudit = removeAllowedUiToolPayloads(rawText)
  for (const line of textForAudit.split(/\r?\n/u)) {
      const opaqueMatches = [...line.matchAll(opaqueTokenPattern)]
      opaqueTokenPattern.lastIndex = 0
      const hasMarker = thinkingSignatureMarkerPattern.test(line)
      const looksInternal = isInternalReasoningSegment(line)

      if (opaqueMatches.length > 0) reasons.add("opaque-token")
      if (hasMarker) reasons.add("thinking-signature-marker")
      if (looksInternal) reasons.add("internal-reasoning-line")
  }
  if (internalModelCodenamePattern.test(textForAudit)) reasons.add("internal-model-codename")
  internalModelCodenamePattern.lastIndex = 0
  if (
    langPrimaryWrapperPattern.test(textForAudit) ||
    languagePrefixMarkerPattern.test(textForAudit) ||
    xmlLikeTagPattern.test(textForAudit)
  ) {
    reasons.add("internal-markup")
  }
  xmlLikeTagPattern.lastIndex = 0

  return {
    detected: reasons.size > 0,
    reasons: [...reasons],
  }
}

function removeAllowedUiToolPayloads(text: string): string {
  let next = text
  for (const candidate of extractJsonObjectCandidates(text)) {
    const parsed = parseJson(candidate)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue
    const tool = (parsed as Record<string, unknown>).tool
    if (tool === "show_choice_panel" || tool === "show_booking_card") {
      next = next.replace(candidate, "")
    }
  }
  return next
}

function normalizeDisplayText(text: string): string {
  return text.replace(/\s{2,}/gu, " ").trim()
}
