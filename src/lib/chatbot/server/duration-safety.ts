import type { JobContext, RoutingDecision } from "@/lib/chatbot/domain"

export type ChatbotDurationSafetyReport = {
  workflowEstimate?: {
    totalMinDays: number
    totalMaxDays: number
  }
  corrections: Array<{
    statedMinDays: number
    statedMaxDays: number
    expectedMinDays: number
    expectedMaxDays: number
    reason:
      | "clearly-outside-workflow-estimate"
      | "unsupported-live-duration-estimate"
      | "included-additional-work-as-baseline"
  }>
}

export function evaluateWorkflowDurationSafety(
  rawText: string,
  options: { routingDecision?: RoutingDecision; jobContext?: JobContext } = {},
): { text: string; report: ChatbotDurationSafetyReport } {
  void options
  const text = rawText.replace(/[^。！？\n]+[。！？]?/gu, (sentence) => {
    const dayRange = /(?<![\d/月])\*{0,2}\d+(?:\.\d+)?\s*(?:日\s*から\s*|[〜～-]\s*)\d+(?:\.\d+)?\s*日/u.test(sentence)
    const singleDuration = /(?<![\d/月])\*{0,2}\d+(?:\.\d+)?\s*(?:営業)?日\*{0,2}\s*(?:間|程度|ほど|くらい|前後|必要|かか|です|で|が|を)/u.test(sentence)
    const workCount = /(?:工程|作業|立ち会い|立会|仕込み|QC|コンフォーム|グレーディング|所要|日数|目安)[^。！？\n]*?(?<![\d/月])\d+(?:\.\d+)?\s*(?:営業)?日/u.test(sentence)
    return dayRange || singleDuration || workCount ? "日程は則兼と相談して決めます。" : sentence
  })
  return { text, report: { corrections: [] } }
}
