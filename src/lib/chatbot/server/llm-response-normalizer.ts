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
  return text.replace(
    /(?:工程|作業)(?:の)?(?:目安|期間|日数)?(?:は|としては|:|：)?\s*\d+(?:\.\d+)?\s*(?:日\s*から\s*|[〜～\-ー]\s*)\d+(?:\.\d+)?\s*日/gu,
    (match) =>
      match.replace(
        /\d+(?:\.\d+)?\s*(?:日\s*から\s*|[〜～\-ー]\s*)\d+(?:\.\d+)?\s*日/u,
        expected,
      ),
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
