import type { JobContext, RoutingDecision, SurveyChoiceSet } from "@/lib/chatbot/domain"
import {
  evaluateWorkflowDurationSafety,
  type ChatbotDurationSafetyReport,
} from "@/lib/chatbot/server/duration-safety"
import type {
  ChatbotLlmDisplayEnvelope,
  ChatbotLlmOutputContractRejectionReason,
  ChatbotLlmResponse,
} from "@/lib/chatbot/server/llm-client"

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
      | "unsafe-fallback-text"
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
      | "english-reasoning-prose"
      | "internal-model-codename"
      | "internal-markup"
      | "internal-booking-ui-state"
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
    fallbackText?: string
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
    fallbackText?: string
  } = {},
): { text: string; report: ChatbotLlmSanitizationReport } {
  const lastResortFallbackText = "内容を確認しました。続けて相談内容を送ってください。"
  const fallbackText =
    (options.fallbackText ??
      (options.routingDecision?.kind === "continue"
        ? options.routingDecision.nextQuestion
        : "内容を確認しました。次に必要な情報を1つずつ確認します。")).trim() || lastResortFallbackText
  const extraction = toDisplayBoundaryExtraction(
    options.displayEnvelope ??
      (options.trustedDisplayText
        ? createTrustedChatbotLlmDisplayEnvelope(rawText)
        : createChatbotLlmDisplayEnvelope(rawText)),
  )
  const unsafe = extraction.text ? detectUnsafeCustomerFacingArtifacts(extraction.text) : noUnsafeArtifacts()
  // Inside an explicit customer-reply boundary the model has already declared which text is for
  // the customer, so English prose alone must not discard the whole reply. Dropping it there left
  // every non-Japanese visitor with a canned Japanese sentence and no answer.
  const explicitBoundary = extraction.source === "customer-reply-tag" || extraction.source === "json-customer-reply"
  const blockingReasons = explicitBoundary
    ? unsafe.reasons.filter((reason) => reason !== "english-reasoning-prose")
    : unsafe.reasons
  const useFallback = !extraction.text || blockingReasons.length > 0
  const fallbackUnsafe = useFallback ? detectUnsafeCustomerFacingArtifacts(fallbackText) : noUnsafeArtifacts()
  const displayText = useFallback
    ? fallbackUnsafe.detected
      ? lastResortFallbackText
      : fallbackText
    : extraction.text
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
        ...(fallbackUnsafe.detected ? (["unsafe-fallback-text"] as const) : []),
      ],
    },
  }

  if (unsafe.detected || fallbackUnsafe.detected) {
    report.unsafeArtifacts = {
      detected: true,
      fallbackApplied: useFallback,
      reasons: [...new Set([...unsafe.reasons, ...fallbackUnsafe.reasons])],
    }
  }

  return { text: durationResult.text, report }
}

export function createChatbotLlmDisplayEnvelope(rawText: string): ChatbotLlmDisplayEnvelope {
  return createDisplayEnvelope(extractExplicitCustomerDisplayText(rawText), rawText)
}

export function createTrustedChatbotLlmDisplayEnvelope(rawText: string): ChatbotLlmDisplayEnvelope {
  return createDisplayEnvelope(
    {
      text: rawText.trim(),
      source: "trusted-server-display",
      defaultDenied: false,
      fallbackApplied: false,
      reasons: ["trusted-server-display"],
    },
    rawText,
  )
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
// Split by what the phrase proves. Talking *about* the customer in the third person, or
// narrating the next move, only happens when the model is thinking aloud. Ordinary first-person
// service English ("I can help", "I would need to know") is how a real English answer reads, so
// it cannot decide the outcome on its own.
const internalReasoningEnglishPattern =
  /\b(?:the\s+)?(?:user|customer)\s+(?:said|says|selected|asked|answered|chose|wants?|mentioned|indicated|responded|is|has|gave|provided|replied)\b|\blooking at the (?:conversation|context)\b|\bconfirmed facts?\b|\bwhat'?s\s+(?:still\s+)?missing\b|\bstill\s+missing\b|\bno particular preferences?\b|\bnow i\b|\bi\s+should\b|\blet(?:'|’)?s\b|\blet\s+(?:me|us)\b/iu
const englishFirstPersonServicePattern =
  /\b(?:i|we)\s+(?:need|will|would|have|must|think|can|am|could|'ll|'m|'ve)\b|\bi'?ll\b/iu
const internalMachineIdentifierPattern =
  /\b(?:show_booking_card|show_choice_panel|projectTitle|contactName|contactEmail|companyName|dueDate|selectionMode|allowFreeText|choiceSetId|projectLengthMinutes|jobKind|finalMedium)\b/u
const internalBookingUiStatePattern =
  /(?:受付済み|受け付け済み|(?:予約(?:候補)?カード|同じ予約カード|カード).{0,32}(?:再表示|表示しません|作成済み|不要)|(?:再表示).{0,32}(?:予約(?:候補)?カード|カード))/u
const mechanicalRoutingFallbackPattern =
  /^(?:補足を反映しました。必要な点を確認してから進めます。|内容を確認しました。次に必要な情報を1つずつ確認します。)$/u
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
    mechanicalRoutingFallbackPattern.test(trimmed) ||
    isPlainFormJapaneseMonologue(trimmed)
  )
}

// English first-person prose is how a genuine English answer reads, so this heuristic cannot
// prove a leak on its own. It stays a signal, and only decides the outcome for text the model
// never marked as customer-facing.
function isEnglishReasoningProseSegment(segment: string): boolean {
  const trimmed = segment.trim()
  if (trimmed.length === 0) return false
  return englishFirstPersonServicePattern.test(trimmed) || isEnglishReasoningProse(trimmed)
}

type StripReason =
  | "opaque-token"
  | "thinking-signature-marker"
  | "internal-reasoning-line"
  | "english-reasoning-prose"
  | "internal-model-codename"
  | "internal-markup"
  | "internal-booking-ui-state"

type DisplayBoundaryExtraction = Omit<ChatbotLlmDisplayEnvelope, "uiPayload" | "displayText">

function toDisplayBoundaryExtraction(envelope: ChatbotLlmDisplayEnvelope): ChatbotLlmDisplayEnvelope {
  return envelope
}

function createDisplayEnvelope(extraction: DisplayBoundaryExtraction, rawText: string): ChatbotLlmDisplayEnvelope {
  const inspection = inspectStructuredUiPayload(rawText)
  return {
    ...extraction,
    displayText: inspection.candidate
      ? removeStructuredUiCandidate(extraction.text, inspection.candidate)
      : extraction.text,
    uiPayload: inspection.payload,
  }
}

function inspectStructuredUiPayload(text: string): {
  payload: ChatbotLlmDisplayEnvelope["uiPayload"]
  candidate?: string
} {
  for (const candidate of extractJsonObjectCandidates(text)) {
    const parsed = parseJson(candidate)
    if (!isRecord(parsed)) continue
    if (parsed.tool === "show_booking_card") {
      return {
        payload: {
          kind: "booking-card",
          ...(isRecord(parsed.args) ? { args: parsed.args } : {}),
        },
        candidate,
      }
    }
    if (parsed.tool !== "show_choice_panel") continue
    if (!isRecord(parsed.args)) {
      return {
        payload: { kind: "invalid", reason: "choice-set-id-not-allowlisted" },
        candidate,
      }
    }

    const result = inspectChatbotLlmChoiceSet(parsed.args)
    return {
      payload: result.ok
        ? { kind: "choice-panel", choiceSet: result.choiceSet }
        : { kind: "invalid", reason: result.reason },
      candidate,
    }
  }

  const looseChoiceSet = parseLooseShowChoicePanelChoiceSet(text)
  if (looseChoiceSet) return { payload: { kind: "choice-panel", choiceSet: looseChoiceSet } }

  return { payload: { kind: "none" } }
}

function parseLooseShowChoicePanelChoiceSet(text: string): SurveyChoiceSet | undefined {
  if (!/"tool"\s*:\s*"show_choice_panel"/u.test(text)) return undefined

  const argsMatch = /"args"\s*:\s*\{([\s\S]*)/u.exec(text)
  const source = argsMatch?.[1] ?? text
  const id = parseLooseJsonStringMatch(/"id"\s*:\s*"((?:\\.|[^"\\]){1,80})"/u.exec(source)?.[1])
  const question = parseLooseJsonStringMatch(/"question"\s*:\s*"((?:\\.|[^"\\]){1,180})"/u.exec(source)?.[1])
  const choicesStart = source.indexOf('"choices"')
  const choiceSource = choicesStart >= 0 ? source.slice(choicesStart) : source
  const choices: Array<SurveyChoiceSet["choices"][number]> = []
  const seenChoiceIds = new Set<string>()
  const choicePattern =
    /\{\s*"id"\s*:\s*"((?:\\.|[^"\\]){1,80})"\s*,\s*"label"\s*:\s*"((?:\\.|[^"\\]){1,120})"/gu
  let match: RegExpExecArray | null

  while ((match = choicePattern.exec(choiceSource)) && choices.length < 10) {
    const choice = normalizeChatbotLlmChoice({
      id: parseLooseJsonStringMatch(match[1]),
      label: parseLooseJsonStringMatch(match[2]),
    })
    if (!choice || seenChoiceIds.has(choice.id)) continue
    seenChoiceIds.add(choice.id)
    choices.push(choice)
  }

  return normalizeChatbotLlmChoiceSetAtDisplayBoundary({
    id,
    question,
    choices,
    selectionMode: /"selectionMode"\s*:\s*"multiple"/u.test(source) ? "multiple" : undefined,
    allowFreeText: /"allowFreeText"\s*:\s*true/u.test(source),
  })
}

function parseLooseJsonStringMatch(value: string | undefined): string | undefined {
  if (!value) return undefined
  const parsed = parseJson(`"${value}"`)
  return typeof parsed === "string" ? parsed : value
}

function removeStructuredUiCandidate(text: string, candidate: string): string {
  return normalizeDisplayText(
    text
      .replace(candidate, "")
      .replace(/```json\s*```/giu, "")
      .replace(/```\s*```/gu, ""),
  )
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
  candidates.push(...extractBalancedJsonObjectCandidates(text))
  return [...new Set(candidates)]
}

function extractBalancedJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === "{") {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (char !== "}" || depth === 0) continue
    depth -= 1
    if (depth === 0 && start >= 0) {
      candidates.push(text.slice(start, index + 1))
      start = -1
    }
  }

  return candidates
}

const llmChoicePanelIds = new Set([
  "job-kind",
  "project-length",
  "final-medium",
  "additional-work",
  "documentary-attachment",
  "work-site",
  "production-options",
])

export function normalizeChatbotLlmChoiceSetAtDisplayBoundary(
  value: Record<string, unknown>,
): SurveyChoiceSet | undefined {
  const result = inspectChatbotLlmChoiceSet(value)
  return result.ok ? result.choiceSet : undefined
}

function inspectChatbotLlmChoiceSet(value: Record<string, unknown>):
  | { ok: true; choiceSet: SurveyChoiceSet }
  | { ok: false; reason: ChatbotLlmOutputContractRejectionReason } {
  const id = optionalString(value.id)
  if (!id || !llmChoicePanelIds.has(id)) {
    return { ok: false, reason: "choice-set-id-not-allowlisted" }
  }

  const question = optionalString(value.question)
  if (!question) return { ok: false, reason: "choice-set-question-missing" }
  if (question.length > 140) return { ok: false, reason: "choice-set-question-too-long" }

  const rawChoices = Array.isArray(value.choices) ? value.choices : []
  if (rawChoices.length < 2 || rawChoices.length > 10) {
    return { ok: false, reason: "choice-set-choice-count-out-of-range" }
  }
  const choices = rawChoices.map(normalizeChatbotLlmChoice)
  if (choices.some((choice) => !choice)) {
    return { ok: false, reason: "choice-set-choice-invalid" }
  }

  return {
    ok: true,
    choiceSet: {
      id,
      question,
      choices: choices as SurveyChoiceSet["choices"],
      ...(value.selectionMode === "multiple" ? { selectionMode: "multiple" as const } : {}),
      ...(value.allowFreeText === true ? { allowFreeText: true } : {}),
    },
  }
}

function normalizeChatbotLlmChoice(value: unknown): SurveyChoiceSet["choices"][number] | undefined {
  if (!isRecord(value)) return undefined
  const id = optionalString(value.id)
  const label = optionalString(value.label)
  if (!id || !label) return undefined
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(id)) return undefined
  if (label.length > 80) return undefined
  return { id, label }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
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
      if (isEnglishReasoningProseSegment(line)) reasons.add("english-reasoning-prose")
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
  if (internalBookingUiStatePattern.test(textForAudit)) reasons.add("internal-booking-ui-state")
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
