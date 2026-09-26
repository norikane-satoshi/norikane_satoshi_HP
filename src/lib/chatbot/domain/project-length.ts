/**
 * Customer-facing project length. Short CMs are stored as fractional minutes (15 seconds is 0.25),
 * which read as "0.25分" when printed directly, so sub-minute parts are shown in seconds.
 */
export function formatProjectLengthMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return `${minutes}分`
  if (minutes >= 60) {
    const hours = minutes / 60
    return Number.isInteger(hours) ? `${hours}時間` : `${hours.toFixed(1).replace(/\.0$/u, "")}時間`
  }
  const wholeMinutes = Math.floor(minutes)
  const seconds = Math.round((minutes - wholeMinutes) * 60)
  if (wholeMinutes === 0) return `${seconds}秒`
  return seconds === 0 ? `${wholeMinutes}分` : `${wholeMinutes}分${seconds}秒`
}
