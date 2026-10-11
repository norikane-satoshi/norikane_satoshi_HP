/** Calendar date keys use Japan time, independently of the browser/server timezone. */
export function todayInJapan(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function isSelectableDeadline(value: string, now = new Date()): boolean {
  return isCalendarDate(value) && value >= todayInJapan(now)
}

export function deadlineFromMessage(message: string): string | undefined {
  return message.match(/^(?:納期|納品希望日)[ \t]*[:：][ \t]*([^\n]*)$/mu)?.[1]?.trim()
}

/** Customers choose a calendar date or explicitly leave it undecided. */
export function isValidDeadlineInput(value: string, now = new Date()): boolean {
  return normalizeDeadlineInput(value, now) !== undefined
}

export function normalizeDeadlineInput(value: string, now = new Date()): string | undefined {
  const text = value.normalize("NFKC").trim().replace(/[。.!！]+$/u, "")
  if (/^(?:未定|まだ未定|まだ決まっていない|決まっていない|わからない|分からない|不明|相談したい)$/u.test(text)) return "未定"
  const match = /^(?:(\d{4})[\/年-])?(\d{1,2})[\/月-](\d{1,2})日?$/u.exec(text)
  if (!match) return undefined
  const year = match[1] ?? todayInJapan(now).slice(0, 4)
  const date = `${year}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`
  return isSelectableDeadline(date, now) ? date : undefined
}

/** Free text stays in the summary; only an unambiguous date constrains availability. */
export function deadlineForScheduling(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (isCalendarDate(value)) return value
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined
}
