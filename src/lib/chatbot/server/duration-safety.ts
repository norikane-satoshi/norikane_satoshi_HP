import type { JobContext, RoutingDecision, WorkflowEstimate } from "@/lib/chatbot/domain"
import { estimateWorkflow } from "@/lib/chatbot/server/duration-estimator"

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
    reason: "clearly-outside-workflow-estimate" | "unsupported-live-duration-estimate"
  }>
}

export function evaluateWorkflowDurationSafety(
  rawText: string,
  options: { routingDecision?: RoutingDecision; jobContext?: JobContext } = {},
): { text: string; report: ChatbotDurationSafetyReport } {
  const estimate = resolveWorkflowEstimate(options.routingDecision, options.jobContext)
  const report: ChatbotDurationSafetyReport = {
    ...(estimate
      ? {
          workflowEstimate: {
            totalMinDays: estimate.totalMinDays,
            totalMaxDays: estimate.totalMaxDays,
          },
        }
      : {}),
    corrections: [],
  }
  if (!estimate) return { text: rawText, report }

  if (estimate.estimateStatus === "needs-confirmation" && estimate.unsupportedReason === "live-duration-outside-baseline") {
    return {
      text: alignUnsupportedLiveDurationText(rawText, estimate, report),
      report,
    }
  }

  const expected = `${formatDays(estimate.totalMinDays)}〜${formatDays(estimate.totalMaxDays)}日`
  const alignedText = rawText.replace(workflowRangePattern, (match, prefix: string, rawRange: string) => {
    const stated = parseDayRange(rawRange)
    if (!stated || !isClearlyOutsideWorkflowEstimate(stated, estimate)) return match

    report.corrections.push({
      statedMinDays: stated.minDays,
      statedMaxDays: stated.maxDays,
      expectedMinDays: estimate.totalMinDays,
      expectedMaxDays: estimate.totalMaxDays,
      reason: "clearly-outside-workflow-estimate",
    })

    return `${prefix}${expected}`
  })

  return { text: alignedText, report }
}

const workflowRangePattern =
  /((?:工程|作業|所要日数|日数|期間|目安|見積(?:もり)?|納品まで|カラーグレーディング)[^。！？\n]{0,60}?)(\*{0,2}\d+(?:\.\d+)?\s*(?:日\s*から\s*|[〜～\-ー]\s*)\d+(?:\.\d+)?\s*日?\*{0,2})/gu

const sentenceWithDurationDayPattern =
  /[^。！？\n]*(?:(?:\*{0,2}\d+(?:\.\d+)?\s*(?:日\s*から\s*|[〜～\-ー]\s*)\d+(?:\.\d+)?\s*日?\*{0,2})|(?<![\/\d月])\*{0,2}\d+(?:\.\d+)?\s*日\*{0,2}\s*(?:程度|ほど|くらい|前後|が|で|です|かか|必要|見込|目安|ライン|通常))[^。！？\n]*(?:[。！？]|$)/gu

const dayRangeMentionPattern =
  /\*{0,2}(\d+(?:\.\d+)?)\s*(?:日\s*から\s*|[〜～\-ー]\s*)(\d+(?:\.\d+)?)\s*日?\*{0,2}/gu

const singleDurationDayMentionPattern =
  /(?<![\/\d月])\*{0,2}(\d+(?:\.\d+)?)\s*日\*{0,2}\s*(?:程度|ほど|くらい|前後|が|で|です|かか|必要|見込|目安|ライン|通常)/gu

function parseDayRange(rawRange: string): { minDays: number; maxDays: number } | undefined {
  const values = [...rawRange.matchAll(/\d+(?:\.\d+)?/gu)].map((match) => Number(match[0]))
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) return undefined

  return {
    minDays: Math.min(values[0], values[1]),
    maxDays: Math.max(values[0], values[1]),
  }
}

function isClearlyOutsideWorkflowEstimate(
  stated: { minDays: number; maxDays: number },
  estimate: WorkflowEstimate,
): boolean {
  const expectedMin = estimate.totalMinDays
  const expectedMax = estimate.totalMaxDays
  const overlaps = stated.maxDays >= expectedMin && stated.minDays <= expectedMax
  const toleranceDays = Math.max(2, (expectedMax - expectedMin) * 2)

  if (overlaps && stated.minDays >= expectedMin - toleranceDays && stated.maxDays <= expectedMax + toleranceDays) {
    return false
  }

  const tooHigh = stated.minDays > expectedMax + toleranceDays && stated.minDays > expectedMax * 1.25
  const tooLow = stated.maxDays < expectedMin - toleranceDays && stated.maxDays < expectedMin * 0.75

  return tooHigh || tooLow
}

function alignUnsupportedLiveDurationText(
  rawText: string,
  estimate: WorkflowEstimate,
  report: ChatbotDurationSafetyReport,
): string {
  const safeText = buildUnsupportedLiveDurationSafeText(estimate)
  let insertedSafeText = false

  const alignedText = rawText.replace(sentenceWithDurationDayPattern, (sentence) => {
    const statedRanges = parseDayMentions(sentence)
    if (statedRanges.length === 0 || isAllowedLiveReferenceSentence(sentence, statedRanges, estimate)) {
      return sentence
    }

    for (const stated of statedRanges) {
      report.corrections.push({
        statedMinDays: stated.minDays,
        statedMaxDays: stated.maxDays,
        expectedMinDays: estimate.referenceMinDays ?? estimate.totalMinDays,
        expectedMaxDays: estimate.referenceMaxDays ?? estimate.totalMaxDays,
        reason: "unsupported-live-duration-estimate",
      })
    }

    if (insertedSafeText) return ""
    insertedSafeText = true
    return safeText
  })

  return alignedText.replace(/\s{2,}/gu, " ").trim()
}

function buildUnsupportedLiveDurationSafeText(estimate: WorkflowEstimate): string {
  const referenceMinDays = estimate.referenceMinDays ?? estimate.totalMinDays
  const referenceMaxDays = estimate.referenceMaxDays ?? estimate.totalMaxDays

  return `60分ライブの参考基準は${formatDays(referenceMinDays)}〜${formatDays(referenceMaxDays)}日です。今回の尺では素材量・カメラ数・ぼかし箇所・チェック体制を確認して判断します。`
}

function parseDayMentions(sentence: string): Array<{ minDays: number; maxDays: number }> {
  const ranges = [...sentence.matchAll(dayRangeMentionPattern)]
    .map((match) => ({
      minDays: Math.min(Number(match[1]), Number(match[2])),
      maxDays: Math.max(Number(match[1]), Number(match[2])),
    }))
    .filter((range) => Number.isFinite(range.minDays) && Number.isFinite(range.maxDays))
  if (ranges.length > 0) return ranges

  const singles = [...sentence.matchAll(singleDurationDayMentionPattern)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value))
    .map((value) => ({ minDays: value, maxDays: value }))

  return [...ranges, ...singles]
}

function isAllowedLiveReferenceSentence(
  sentence: string,
  statedRanges: Array<{ minDays: number; maxDays: number }>,
  estimate: WorkflowEstimate,
): boolean {
  const referenceMinDays = estimate.referenceMinDays ?? estimate.totalMinDays
  const referenceMaxDays = estimate.referenceMaxDays ?? estimate.totalMaxDays
  const describesReference = /60\s*分/u.test(sentence) && /(?:参考|基準|正本)/u.test(sentence)

  return (
    describesReference &&
    statedRanges.every(
      (range) => range.minDays === referenceMinDays && range.maxDays === referenceMaxDays,
    )
  )
}

function resolveWorkflowEstimate(
  routingDecision: RoutingDecision | undefined,
  jobContext?: JobContext,
): WorkflowEstimate | undefined {
  if (routingDecision?.kind === "to-booking-inline") return routingDecision.jobContext.workflowEstimate
  if (routingDecision?.kind === "to-email") return routingDecision.summary.jobContext.workflowEstimate
  if (jobContext?.workflowEstimate) return jobContext.workflowEstimate
  if (!jobContext?.jobKind) return undefined

  try {
    return estimateWorkflow(jobContext)
  } catch {
    return undefined
  }
}

function formatDays(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "")
}
