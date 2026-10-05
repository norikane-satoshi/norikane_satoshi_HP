export type WorkCompositionRow = { name?: string; count: number; durationSeconds?: number }

export function validWorkComposition(rows: ReadonlyArray<WorkCompositionRow>): boolean {
  return rows.length > 0 && rows.every(({ count, durationSeconds }) =>
    Number.isSafeInteger(count) && count > 0 && (durationSeconds === undefined || (Number.isSafeInteger(durationSeconds) && durationSeconds > 0)),
  )
}

/** An unanswered duration never becomes a representative length or zero. */
export function totalWorkCompositionSeconds(rows: ReadonlyArray<WorkCompositionRow>): number | undefined {
  if (!validWorkComposition(rows) || rows.some(({ durationSeconds }) => durationSeconds === undefined)) return undefined
  const total = rows.reduce((sum, row) => sum + row.count * row.durationSeconds!, 0)
  return Number.isSafeInteger(total) ? total : undefined
}
export function totalWorkCompositionMinutes(rows: ReadonlyArray<WorkCompositionRow>): number | undefined {
  const seconds = totalWorkCompositionSeconds(rows)
  return seconds === undefined ? undefined : seconds / 60
}

export function formatDurationSeconds(seconds: number): string {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return "未確認"
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return `${hours ? `${hours}時間` : ""}${minutes ? `${minutes}分` : ""}${remainder ? `${remainder}秒` : ""}`
}
export function formatWorkComposition(rows: ReadonlyArray<WorkCompositionRow>): string {
  if (!validWorkComposition(rows)) return "未確認"
  return rows.map((row, index) => `${row.name?.trim() || `作品${index + 1}`} ${row.count}本 × ${row.durationSeconds === undefined ? "尺未確認" : formatDurationSeconds(row.durationSeconds)}`).join(" / ")
}
