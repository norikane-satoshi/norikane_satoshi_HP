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
  const estimate = resolveWorkflowEstimate(options.routingDecision, options.jobContext)
  const jobContext = resolveWorkflowEstimateJobContext(options.routingDecision, options.jobContext)
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
      text: alignUnsupportedLiveDurationText(rawText, estimate, report, jobContext),
      report,
    }
  }

  if (jobContext?.jobKind === "live-60m" || jobContext?.finalMedium === "live") {
    return {
      text: alignLiveDurationText(rawText, estimate, report, jobContext),
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
  jobContext?: JobContext,
): string {
  const safeText = buildUnsupportedLiveDurationSafeText(estimate, jobContext)
  let insertedSafeText = false

  const alignedText = rawText.replace(sentenceWithDurationDayPattern, (sentence) => {
    const statedRanges = parseDayMentions(sentence)
    if (statedRanges.length === 0) return sentence

    if (includesAddOnOrDeliveryAsBaseline(sentence)) {
      for (const stated of statedRanges) {
        report.corrections.push({
          statedMinDays: stated.minDays,
          statedMaxDays: stated.maxDays,
          expectedMinDays: estimate.referenceMinDays ?? estimate.totalMinDays,
          expectedMaxDays: estimate.referenceMaxDays ?? estimate.totalMaxDays,
          reason: "included-additional-work-as-baseline",
        })
      }

      if (insertedSafeText) return ""
      insertedSafeText = true
      return safeText
    }

    if (isAllowedLiveReferenceSentence(sentence, statedRanges, estimate)) {
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

function alignLiveDurationText(
  rawText: string,
  estimate: WorkflowEstimate,
  report: ChatbotDurationSafetyReport,
  jobContext?: JobContext,
): string {
  const safeText = buildLiveDurationSafeText(estimate, jobContext)
  let insertedSafeText = false

  const alignedText = rawText.replace(sentenceWithDurationDayPattern, (sentence) => {
    const statedRanges = parseDayMentions(sentence)
    if (statedRanges.length === 0) return sentence

    if (includesAddOnOrDeliveryAsBaseline(sentence)) {
      for (const stated of statedRanges) {
        report.corrections.push({
          statedMinDays: stated.minDays,
          statedMaxDays: stated.maxDays,
          expectedMinDays: estimate.totalMinDays,
          expectedMaxDays: estimate.totalMaxDays,
          reason: "included-additional-work-as-baseline",
        })
      }

      if (insertedSafeText) return ""
      insertedSafeText = true
      return safeText
    }

    if (isAllowedLiveEstimateSentence(sentence, statedRanges, estimate)) {
      return sentence
    }

    for (const stated of statedRanges) {
      report.corrections.push({
        statedMinDays: stated.minDays,
        statedMaxDays: stated.maxDays,
        expectedMinDays: estimate.totalMinDays,
        expectedMaxDays: estimate.totalMaxDays,
        reason: "clearly-outside-workflow-estimate",
      })
    }

    if (insertedSafeText) return ""
    insertedSafeText = true
    return safeText
  })

  return alignedText.replace(/\s{2,}/gu, " ").trim()
}

function buildUnsupportedLiveDurationSafeText(estimate: WorkflowEstimate, jobContext?: JobContext): string {
  const referenceMinDays = estimate.referenceMinDays ?? estimate.totalMinDays
  const referenceMaxDays = estimate.referenceMaxDays ?? estimate.totalMaxDays

  return `ライブ${formatProjectLength(jobContext?.projectLengthMinutes)}の暫定上限目安は${formatDayRange(referenceMinDays, referenceMaxDays)}です。顔ぼかしなどの追加作業やディスク納品の条件によっては、基本目安から前後・追加になる可能性があります。納品形式や追加作業量を確認します。`
}

function buildLiveDurationSafeText(estimate: WorkflowEstimate, jobContext?: JobContext): string {
  return `ライブ${formatProjectLength(jobContext?.projectLengthMinutes)}の基本目安は${formatDayRange(estimate.totalMinDays, estimate.totalMaxDays)}程度です。顔ぼかしなどの追加作業やディスク納品の条件によっては、基本目安から前後・追加になる可能性があります。納品形式や追加作業量を確認します。`
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

function includesAddOnOrDeliveryAsBaseline(sentence: string): boolean {
  return (
    /(?:込み|含め|含んで|でしたら|であれば|込みで|納品込み|作業込み)/u.test(sentence) &&
    /(?:顔ぼかし|ぼかし|消し物|肌修正|追加作業|付随作業|dvd|DVD|ブルーレイ|ディスク|納品媒体|納品形式|納品)/u.test(
      sentence,
    )
  )
}

function isAllowedLiveEstimateSentence(
  sentence: string,
  statedRanges: Array<{ minDays: number; maxDays: number }>,
  estimate: WorkflowEstimate,
): boolean {
  if (isAllowedLiveReferenceSentence(sentence, statedRanges, estimate)) return true

  return statedRanges.every(
    (range) => range.minDays === estimate.totalMinDays && range.maxDays === estimate.totalMaxDays,
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

function resolveWorkflowEstimateJobContext(
  routingDecision: RoutingDecision | undefined,
  jobContext?: JobContext,
): JobContext | undefined {
  if (routingDecision?.kind === "to-booking-inline") return routingDecision.jobContext
  if (routingDecision?.kind === "to-email") return routingDecision.summary.jobContext
  return jobContext
}

function formatDays(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "")
}

function formatDayRange(minDays: number, maxDays: number): string {
  if (minDays === maxDays) return `${formatDays(minDays)}日`
  return `${formatDays(minDays)}〜${formatDays(maxDays)}日`
}

function formatProjectLength(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return ""
  if (value === 60) return "60分"
  if (value >= 60 && value % 60 === 0) return `${value / 60}時間`
  if (value > 60) return `${Math.floor(value / 60)}時間${value % 60}分`
  return `${value}分`
}
