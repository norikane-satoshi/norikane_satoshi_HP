/**
 * Customer-facing project length. Short CMs are stored as fractional minutes (15 seconds is 0.25),
 * which read as "0.25分" when printed directly, so sub-minute parts are shown in seconds.
 */
export function formatProjectLengthMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return `${minutes}分`
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const remainder = minutes - hours * 60
    return remainder === 0 ? `${hours}時間` : `${hours}時間${formatProjectLengthMinutes(remainder)}`
  }
  const wholeMinutes = Math.floor(minutes)
  const seconds = Math.round((minutes - wholeMinutes) * 60)
  if (wholeMinutes === 0) return `${seconds}秒`
  return seconds === 0 ? `${wholeMinutes}分` : `${wholeMinutes}分${seconds}秒`
}

/** Parse an exact customer-authored duration; ranges and approximations are not exact facts. */
export function parseProjectLengthMinutes(value: string): number | undefined {
  const normalized = value.normalize("NFKC").trim().replace(/^尺\s*[:：]\s*/u, "")
  const halfHours = /^(\d+)\s*時間半$/u.exec(normalized)
  if (halfHours) {
    const minutes = Number(halfHours[1]) * 60 + 30
    return Number.isFinite(minutes) ? minutes : undefined
  }
  const match = /^(?:(\d+)\s*時間)?\s*(?:(\d+(?:\.\d+)?)\s*分)?\s*(?:(\d+)\s*秒)?$/u.exec(normalized)
  if (!match || !match.slice(1).some(Boolean)) return undefined
  const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0) + Number(match[3] ?? 0) / 60
  return Number.isFinite(minutes) && minutes > 0 ? minutes : undefined
}
