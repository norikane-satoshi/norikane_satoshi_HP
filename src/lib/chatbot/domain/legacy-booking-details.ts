import { formatProjectLengthMinutes, parseProjectLengthMinutes } from "./project-length"
import type { ChatbotMessage, ConversationState } from "./conversation"
import { matchChoiceAnswer } from "./choice-answer"
import type { BookingDetail, BookingDetailLabel } from "./booking-details"
import { projectConditionDefinitions } from "@/lib/booking/domain/project-conditions"

/** Read-only compatibility for logs written before question-ID answers. Do not use for new writes. */
const choiceLabels = Object.fromEntries(projectConditionDefinitions.filter((definition) => !("summary" in definition && definition.summary === false)).map((definition) => [definition.id, definition.id === "project-length" ? "尺" : definition.label])) as Record<string, BookingDetailLabel>

/** Only customer messages and exactly matched choices are evidence; estimates are never answers. */
export function legacyConfirmedBookingDetails(input: {
  messages?: ReadonlyArray<ChatbotMessage>
  conversationState?: Partial<ConversationState>
}, compatibility: {
  bookingDetailLabels: readonly BookingDetailLabel[]
  unconfirmedBookingValue: string
  canonicalBookingDetails: (details: ReadonlyArray<BookingDetail>) => BookingDetail[]
  canonicalBookingDetailValue: (label: BookingDetailLabel, value: string) => string
}): BookingDetail[] {
  const { bookingDetailLabels, unconfirmedBookingValue, canonicalBookingDetails, canonicalBookingDetailValue } = compatibility
  const values = new Map<BookingDetailLabel, string>()
  let answeredLectureChoice = false
  let askedLength = false
  let askedText: BookingDetailLabel | undefined
  for (const message of input.messages ?? []) {
    if (message.role === "assistant") {
      askedText = /納品形式.*(?:教えて|選んで|[?？])/u.test(message.content) ? "納品形式" : /DCP.*作成担当.*(?:教えて|選んで|[?？])/u.test(message.content) ? "DCP作成担当" : /素材.*揃う日.*(?:教えて|選んで|[?？])/u.test(message.content) ? "素材が揃う日" : undefined
      askedLength = /(?:尺|本編の長さ|作品の長さ).*(?:教えて|入力|選んで|[?？])/u.test(message.content)
      continue
    }
    if (message.role !== "user") continue
    const replyToText = askedText
    askedText = undefined
    if (replyToText && !/[?？]|[:：]/u.test(message.content) && message.content.trim()) values.set(replyToText, canonicalBookingDetailValue(replyToText, message.content.trim().replace(/^選択\s*[:：]\s*/u, "")))
    const replyToLength = askedLength
    askedLength = false
    if (replyToLength && /^(?:未定|不明|未確認)$/u.test(message.content.trim())) {
      values.set("尺", unconfirmedBookingValue)
      continue
    }
    const stored = input.conversationState?.choiceAnswers?.[message.id]
    const answer = stored && matchChoiceAnswer(stored.choiceSet, message.content)
    const label = answer && choiceLabels[answer.choiceSet.id]
    if (answer && label) {
      if (answer.choiceSet.id.startsWith("lecture-training-")) answeredLectureChoice = true
      values.set(label, canonicalBookingDetailValue(label, [...answer.selectedLabels, ...(answer.otherComment ? [answer.otherComment] : [])].join(" / ")))
      continue
    }
    for (const line of message.content.split(/\n|(?<=。)/u)) {
      const explicit = /^([^:：]+)[:：]\s*(.+)$/u.exec(line.trim())
      const explicitName = explicit?.[1].trim()
      const name = explicitName === "納期" ? "納品希望日" : explicitName === "納期理由" ? "納品希望日の理由" : explicitName
      if (name && bookingDetailLabels.includes(name as BookingDetailLabel)) {
        const raw = explicit![2].trim()
        values.set(name as BookingDetailLabel, canonicalBookingDetailValue(name as BookingDetailLabel, raw))
        continue
      }
      if (/^(?:選択|その他コメント)[:：]/u.test(line) || /[?？]|(?:です|ます|でしょう)か|もし|かもしれ|検討中|未定|以前|前の案件/u.test(line)) continue
      if (/(?:短編|長編|ドキュメンタリー)(?:では(?:な|ありませ)|じゃな|でなく)/u.test(line)) values.delete("案件種別")
      if (/(?:時間|分|秒)(?:では(?:な|ありませ)|じゃな|でなく)/u.test(line)) values.delete("尺")
      // Preserve the customer's wording, including ranges and approximation, rather than a numeric anchor.
      const lengths = [...line.matchAll(/(?:約\s*)?\d+(?:\.\d+)?(?:[〜～-]\d+(?:\.\d+)?)?\s*(?:時間(?:半|\s*\d+(?:\.\d+)?分(?:\s*\d+秒)?)?|分(?:\s*\d+秒)?|秒)(?:未満|以内|以上|前後|程度)?/gu)]
        .filter((match) => !/^(?:では(?:な|ありませ)|じゃな|でなく)/u.test(line.slice(match.index! + match[0].length)))
      if (lengths.length === 1 && (replyToLength || /尺|本編|作品|映像|(?:分|秒|時間)の(?:短編|長編|ドキュメンタリー)|(?:cm|CM|MV|ライブ|縦型|本編|長編)/u.test(line))) {
        const raw = lengths[0][0]
        const minutes = parseProjectLengthMinutes(raw)
        values.set("尺", minutes !== undefined ? formatProjectLengthMinutes(minutes) : raw)
      }
      const kinds = [...line.matchAll(/短編(?:ドキュメンタリー|映画)?|長編(?:ドキュメンタリー|映画)?|ドキュメンタリー|ミュージックビデオ|Web CM|企業VP/gu)]
        .filter((match) => !/^(?:では(?:な|ありませ)|じゃな|でなく)/u.test(line.slice(match.index! + match[0].length)))
      if (kinds.length === 1 && /^(?:今回は|案件は|作品は)|(?:分|秒|時間)の(?:短編|長編|ドキュメンタリー)|^(?:短編|長編|ドキュメンタリー|ミュージックビデオ|Web CM|企業VP)(?:です|を)/u.test(line)) values.set("案件種別", kinds[0][0])
    }
  }
  if (!values.has("案件種別") && answeredLectureChoice) {
    values.set("案件種別", projectConditionDefinitions.find(({ id }) => id === "job-kind")!.options.find(({ id }) => id === "lecture-training")!.label)
  }
  return canonicalBookingDetails(bookingDetailLabels.map((label) => ({ label, value: values.get(label) || unconfirmedBookingValue })))
}
