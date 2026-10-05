export function calendarBookingSummary(summary: string, notionTaskType?: string | null): string {
  if (notionTaskType !== "本予約") return summary
  return summary.replaceAll("【仮キープ】", "").replace(/（候補[^）]*）|\(候補[^)]*\)/gu, "").trim()
}
