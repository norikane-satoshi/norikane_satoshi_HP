import type { JobContext, RoutingDecision, WorkflowEstimate } from "@/lib/chatbot/domain"
import type { ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"
import { estimateWorkflow } from "@/lib/chatbot/server/duration-estimator"

export type NormalizedChatbotLlmResponse = {
  content: string
  role: "assistant"
  model: string
  finish_reason: "stop"
}

export function normalizeChatbotLlmResponse(
  response: ChatbotLlmResponse,
  options: { routingDecision?: RoutingDecision; jobContext?: JobContext } = {},
): NormalizedChatbotLlmResponse {
  return {
    content: sanitizeChatbotLlmText(response.rawText, options),
    role: "assistant",
    model: response.tier,
    finish_reason: "stop",
  }
}

export function sanitizeChatbotLlmText(
  rawText: string,
  options: { routingDecision?: RoutingDecision; jobContext?: JobContext } = {},
): string {
  return alignWorkflowEstimateText(rawText, options.routingDecision, options.jobContext)
}

function alignWorkflowEstimateText(
  text: string,
  routingDecision: RoutingDecision | undefined,
  jobContext?: JobContext,
): string {
  const estimate = resolveWorkflowEstimate(routingDecision, jobContext)
  if (!estimate) return text

  const expected = `${formatDays(estimate.totalMinDays)}〜${formatDays(estimate.totalMaxDays)}日`
  return text.replace(workflowRangePattern, (match, prefix: string, rawRange: string) => {
    const stated = parseDayRange(rawRange)
    if (!stated || !isClearlyOutsideWorkflowEstimate(stated, estimate)) return match

    return `${prefix}${expected}`
  })
}

const workflowRangePattern =
  /((?:工程|作業|所要日数|日数|期間|目安|見積(?:もり)?|納品まで|カラーグレーディング)[^。！？\n]{0,40}?)(\d+(?:\.\d+)?\s*(?:日\s*から\s*|[〜～\-ー]\s*)\d+(?:\.\d+)?\s*日)/gu

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
