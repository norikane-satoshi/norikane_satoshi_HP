import { formatProjectLengthMinutes, parseProjectLengthMinutes } from "./project-length"
import type { ChatbotMessage, ConversationState } from "./conversation"
import { legacyConfirmedBookingDetails } from "./legacy-booking-details"
import { projectConditionDefinitions, projectConditionDetails, isConditionVisible, type ConditionAnswers, type ProjectConditionDefinition, type ProjectConditionLabel } from "@/lib/booking/domain/project-conditions"
import { bookingDateKeyFromDisplay, formatBookingDate } from "@/lib/booking/domain/booking-display"

export const bookingDetailLabels = projectConditionDefinitions.filter((definition) => !("summary" in definition && definition.summary === false)).flatMap((definition) => "detailLabels" in definition ? [...definition.detailLabels] : [definition.label]) as ProjectConditionLabel[]
export type BookingDetailLabel = typeof bookingDetailLabels[number]
export type BookingDetail = { label: BookingDetailLabel; value: string }
export const unconfirmedBookingValue = "未確認"
const internalMemoLabels = ["納期", "納期理由", "作業場所", "依頼内容", "立ち会い日数", "作業日数", "基本工程目安", "工程目安", "受け渡し素材", "素材受け渡し方法", "素材搬入/受け取り時期"]

function definitionForLabel(label: BookingDetailLabel): ProjectConditionDefinition | undefined {
  return projectConditionDefinitions.find((definition) => ("detailLabels" in definition ? definition.detailLabels : [definition.label]).includes(label as never))
}
function detailVisibilityAnswers(details: ReadonlyArray<BookingDetail>): ConditionAnswers {
  const answers: ConditionAnswers = {}
  for (const { label, value } of details) {
    const definition = definitionForLabel(label)
    if (definition) answers[definition.id] = { selectedIds: definition.options.filter((option) => (value === option.label || value.split(" / ").includes(option.label)) || ("aliases" in option && (option.aliases as readonly string[]).some((alias) => value === alias || value.split(" / ").includes(alias)))).map(({ id }) => id) }
  }
  return answers
}
/** Stable question IDs are authoritative; legacy transcripts are a read-only fallback. */
export function confirmedBookingDetails(input: {
  messages?: ReadonlyArray<ChatbotMessage>
  conversationState?: Partial<ConversationState>
}): BookingDetail[] {
  const answers = input.conversationState?.conditionAnswers
  if (answers !== undefined) return canonicalBookingDetails(projectConditionDetails(answers))
  return legacyConfirmedBookingDetails(input, { bookingDetailLabels, unconfirmedBookingValue, canonicalBookingDetails, canonicalBookingDetailValue })
}

export function canonicalBookingDetails(details: ReadonlyArray<BookingDetail>): BookingDetail[] {
  const values = new Map(details.map(({ label, value }) => [label, canonicalBookingDetailValue(label, value)]))
  const answers = detailVisibilityAnswers(details)
  for (const { label } of details) {
    const definition = definitionForLabel(label)
    if (definition && !isConditionVisible(definition, answers)) values.set(label, unconfirmedBookingValue)
  }
  const included = new Set(details.map(({ label }) => label))
  return bookingDetailLabels.filter((label) => included.has(label)).map((label) => ({ label, value: values.get(label) ?? unconfirmedBookingValue }))
}

export function canonicalBookingDetailValue(label: BookingDetailLabel, value: string): string {
  const raw = value.trim()
  const unknown = definitionForLabel(label)?.unknownValue ?? unconfirmedBookingValue
  if (!raw || /^(?:未定|不明|未確認)$/u.test(raw)) return unknown
  if (definitionForLabel(label)?.input === "date") return bookingDateKeyFromDisplay(raw) ?? unconfirmedBookingValue
  if (definitionForLabel(label)?.input === "dates") return raw.split(" / ").map((date) => bookingDateKeyFromDisplay(date) ?? date).join(" / ")
  if (label === "尺") {
    const minutes = parseProjectLengthMinutes(raw)
    if (minutes !== undefined) return formatProjectLengthMinutes(minutes)
    if (/^(?:未定|不明|未確認)$/u.test(raw)) return unconfirmedBookingValue
  }
  return raw || unconfirmedBookingValue
}

export function displayBookingDetails(details: ReadonlyArray<BookingDetail>): BookingDetail[] {
  const canonical = canonicalBookingDetails(details)
  const answers = detailVisibilityAnswers(canonical)
  return canonical.filter(({ label }) => {
    const definition = definitionForLabel(label)
    return !definition || isConditionVisible(definition, answers)
  }).map(({ label, value }) => ({
    label,
    value: definitionForLabel(label)?.input === "date" ? formatBookingDate(value) : definitionForLabel(label)?.input === "dates" ? value.split(" / ").map(formatBookingDate).join(" / ") : value,
  }))
}

export function bookingDetailsMemo(note: string, details: ReadonlyArray<BookingDetail>): string {
  const lines = note.split("\n")
  const unavailableDates = lines.filter((line) => /^\s*都合の悪い日[:：]/u.test(line))
  const ownNote = lines.filter((line) => {
    if (/^\s*都合の悪い日[:：]/u.test(line)) return false
    const label = /^\s*(?:- )?([^:：]+)[:：]/u.exec(line)?.[1]
    return !label || (!bookingDetailLabels.includes(label as BookingDetailLabel) && !internalMemoLabels.includes(label))
  }).join("\n").trim()
  const displayed = displayBookingDetails(details)
  const hasUnavailableAnswer = displayed.some(({ label, value }) => label === "都合の悪い日" && value !== unconfirmedBookingValue)
  return [...(hasUnavailableAnswer ? [] : unavailableDates), ...displayed.filter(({ label, value }) => !(label === "都合の悪い日" && value === unconfirmedBookingValue && unavailableDates.length > 0)).map(({ label, value }) => `${label}: ${value}`), ownNote].filter(Boolean).join("\n")
}

/** Reads saved label/value memos using the same definition labels as current outputs. */
export function readBookingDetailsMemo(memo: string): { details: BookingDetail[]; note: string } {
  const details: BookingDetail[] = []
  const note: string[] = []
  for (const line of memo.split("\n")) {
    const match = /^\s*(?:- )?([^:：]+)[:：]\s*(.*)$/u.exec(line)
    const label = match?.[1].trim()
    if (label && bookingDetailLabels.includes(label as BookingDetailLabel)) details.push({ label: label as BookingDetailLabel, value: match![2] })
    else if (!label || !internalMemoLabels.includes(label)) note.push(line)
  }
  return { details: canonicalBookingDetails(details), note: note.join("\n").trim() }
}

/** A model-written supplemental note is retained only when a whole line is customer-authored. */
export function confirmedBookingNote(messages: ReadonlyArray<ChatbotMessage>, proposed = ""): string {
  const lines = messages.filter((message) => message.role === "user").flatMap((message) => message.content.split("\n").map((line) => line.trim()))
  const labeled = lines.flatMap((line) => /^(?:補足|備考)[:：]\s*(.+)$/u.exec(line)?.[1] ?? [])
  return [...new Set([...labeled, ...proposed.split("\n").map((line) => line.trim()).filter((line) => line && lines.includes(line))])].join("\n")
}
