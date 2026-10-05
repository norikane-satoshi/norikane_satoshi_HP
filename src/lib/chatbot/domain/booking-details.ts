import { formatProjectLengthMinutes, parseProjectLengthMinutes } from "./project-length"
import type { ChatbotMessage, ConversationState } from "./conversation"
import { matchChoiceAnswer } from "./choice-answer"

export const bookingDetailLabels = [
  "案件種別", "尺", "最終媒体", "作業場所/立ち会い", "納品希望日",
  "追加作業", "付随素材", "字幕・テロップ等", "受け渡し素材",
  "素材搬入/受け取り時期", "素材受け渡し方法", "参考URL", "立ち会い日数", "納品形式",
] as const
export type BookingDetailLabel = typeof bookingDetailLabels[number]
export type BookingDetail = { label: BookingDetailLabel; value: string }
export const unconfirmedBookingValue = "未確認"

const choiceLabels: Record<string, BookingDetailLabel> = {
  "job-kind": "案件種別", "project-length": "尺", "final-medium": "最終媒体",
  "work-site": "作業場所/立ち会い", "additional-work": "追加作業",
  "documentary-attachment": "付随素材", "production-options": "字幕・テロップ等",
  "material-contents": "受け渡し素材", "material-timing": "素材搬入/受け取り時期",
  "material-handoff-method": "素材受け渡し方法", "reference-urls": "参考URL",
  "attendance-days": "立ち会い日数", "delivery-format": "納品形式",
}

/** Only customer messages and exactly matched choices are evidence; estimates are never answers. */
export function confirmedBookingDetails(input: {
  messages?: ReadonlyArray<ChatbotMessage>
  conversationState?: Partial<ConversationState>
}): BookingDetail[] {
  const values = new Map<BookingDetailLabel, string>()
  let askedLength = false
  for (const message of input.messages ?? []) {
    if (message.role === "assistant") {
      askedLength = /(?:尺|本編の長さ|作品の長さ).*(?:教えて|入力|選んで|[?？])/u.test(message.content)
      continue
    }
    if (message.role !== "user") continue
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
      values.set(label, [...answer.selectedLabels, ...(answer.otherComment ? [answer.otherComment] : [])].join(" / "))
      continue
    }
    for (const line of message.content.split(/\n|(?<=。)/u)) {
      const explicit = /^([^:：]+)[:：]\s*(.+)$/u.exec(line.trim())
      const explicitName = explicit?.[1].trim()
      const name = explicitName === "納期" ? "納品希望日" : explicitName
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
  return bookingDetailLabels.map((label) => ({ label, value: values.get(label) || unconfirmedBookingValue }))
}

function canonicalBookingDetailValue(label: BookingDetailLabel, value: string): string {
  const raw = value.trim()
  if (label === "尺") {
    const minutes = parseProjectLengthMinutes(raw)
    if (minutes !== undefined) return formatProjectLengthMinutes(minutes)
    if (/^(?:未定|不明|未確認)$/u.test(raw)) return unconfirmedBookingValue
  }
  return raw || unconfirmedBookingValue
}

export function bookingDetailsMemo(note: string, details: ReadonlyArray<BookingDetail>): string {
  const ownNote = note.split("\n").filter((line) => {
    const label = /^\s*(?:- )?([^:：]+)[:：]/u.exec(line)?.[1]
    return !label || (!bookingDetailLabels.includes(label as BookingDetailLabel) && !["納期", "作業場所", "依頼内容"].includes(label))
  }).join("\n").trim()
  return [ownNote, ...details.map(({ label, value }) => `${label}: ${canonicalBookingDetailValue(label, value)}`)].filter(Boolean).join("\n")
}

/** A model-written supplemental note is retained only when a whole line is customer-authored. */
export function confirmedBookingNote(messages: ReadonlyArray<ChatbotMessage>, proposed = ""): string {
  const lines = messages.filter((message) => message.role === "user").flatMap((message) => message.content.split("\n").map((line) => line.trim()))
  const labeled = lines.flatMap((line) => /^(?:補足|備考)[:：]\s*(.+)$/u.exec(line)?.[1] ?? [])
  return [...new Set([...labeled, ...proposed.split("\n").map((line) => line.trim()).filter((line) => line && lines.includes(line))])].join("\n")
}
