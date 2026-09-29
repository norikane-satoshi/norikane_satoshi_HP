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
  return message.match(/^(?:納期|納品希望日)\s*[:：]\s*(.+)$/u)?.[1]?.trim()
}

/** Preserve free-form deadlines; reject invalid/past ISO calendar selections. */
export function isValidDeadlineInput(value: string, now = new Date()): boolean {
  return !/^\d{4}-\d{2}-\d{2}$/.test(value) || isSelectableDeadline(value, now)
}

/** Free text stays in the summary; only an unambiguous date constrains availability. */
export function deadlineForScheduling(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (isCalendarDate(value)) return value
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined
}
