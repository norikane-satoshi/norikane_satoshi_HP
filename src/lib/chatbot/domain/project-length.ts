import { formatDurationSeconds } from "@/lib/booking/domain/work-composition"

export function formatProjectLengthMinutes(minutes: number): string {
  return formatDurationSeconds(Math.round(minutes * 60))
}

/** Parse only exact customer-authored durations, preserving integer seconds. */
export function parseProjectLengthSeconds(value: string): number | undefined {
  const normalized = value.normalize("NFKC").trim().replace(/^尺\s*[:：]\s*/u, "")
  const halfHours = /^(\d+)\s*時間半$/u.exec(normalized)
  if (halfHours) {
    const seconds = Number(halfHours[1]) * 3600 + 1800
    return Number.isSafeInteger(seconds) ? seconds : undefined
  }
  const match = /^(?:(\d+)\s*時間)?\s*(?:(\d+(?:\.\d+)?)\s*分)?\s*(?:(\d+)\s*秒)?$/u.exec(normalized)
  if (!match || !match.slice(1).some(Boolean)) return undefined
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined
}
export function parseProjectLengthMinutes(value: string): number | undefined {
  const seconds = parseProjectLengthSeconds(value)
  return seconds === undefined ? undefined : seconds / 60
}
