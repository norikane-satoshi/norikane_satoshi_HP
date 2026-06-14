import type { JobContext, RoutingDecision, WorkflowEstimate } from "@/lib/chatbot/domain"
import {
  containsPriceQuote,
  directContactPolicyMessage,
  enforceAssistantQuestionLimit,
  removeForbiddenAssistantSurface,
} from "@/lib/chatbot/knowledge"
import type { ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"
import { estimateWorkflow } from "@/lib/chatbot/server/duration-estimator"

export type NormalizedChatbotLlmResponse = {
  content: string
  role: "assistant"
  model: string
  finish_reason: "stop"
}

export const fallbackChatbotAssistantContent =
  "確認しました。案件内容を整理するため、最終媒体・尺・希望時期を教えてください。"

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
  if (options.routingDecision?.kind === "to-direct-contact") {
    return directContactPolicyMessage
  }
  if (options.routingDecision?.kind === "to-booking-inline") {
    const estimate = options.routingDecision.jobContext.workflowEstimate
    const estimatePrefix = estimate
      ? `作業目安は${formatDays(estimate.totalMinDays)}〜${formatDays(estimate.totalMaxDays)}日です。`
      : ""

    return `${estimatePrefix}素材搬入時期と納品希望日は把握しました。先に空き状況の候補を出します。細かい素材情報は分かる範囲で後からで大丈夫です。`
  }
  if (options.routingDecision?.kind === "continue" && options.routingDecision.presentChoices) {
    const nextQuestion = options.routingDecision.nextQuestion.trim()

    return nextQuestion.length > 0 ? nextQuestion : fallbackChatbotAssistantContent
  }
  if (options.routingDecision?.kind === "continue" && isMandatoryContinueQuestion(options.routingDecision.nextQuestion)) {
    return options.routingDecision.nextQuestion.trim()
  }

  const strippedThoughtBlocks = stripThinkBlocksOutsideCodeFences(rawText)
  const strippedLeadingThought = stripLeadingThoughtExplanation(strippedThoughtBlocks)
  const normalizedWhitespace = enforceAssistantQuestionLimit(
    removeForbiddenAssistantSurface(strippedLeadingThought),
  )

  if (containsBackendDisclosure(normalizedWhitespace)) {
    return "のりかね映像設計室の相談窓口として動いています。"
  }

  if (containsPriceQuote(normalizedWhitespace)) return directContactPolicyMessage

  const estimateAligned = alignWorkflowEstimateText(normalizedWhitespace, options.routingDecision, options.jobContext)

  return estimateAligned.length > 0 ? estimateAligned : fallbackChatbotAssistantContent
}

function containsBackendDisclosure(text: string): boolean {
  return /(?:Notion\s*AI|LLM|GPT|Claude|Gemini|モデル名|ベースモデル|ローカル(?:で|実行|環境)|クラウド側|サービス側の仕組み)/iu.test(
    text,
  )
}

function isMandatoryContinueQuestion(nextQuestion: string): boolean {
  return (
    nextQuestion.startsWith("「その他」とは具体的にどのような作業ですか？") ||
    nextQuestion.startsWith("案件名（プロジェクト名・作品名）を教えてください。")
  )
}

function formatDays(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "")
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
    /(?:工程|作業)(?:の)?(?:目安|期間|日数)?(?:は|としては|:|：)?\s*\d+(?:\.\d+)?\s*[〜～\-ー]\s*\d+(?:\.\d+)?\s*日/gu,
    (match) => match.replace(/\d+(?:\.\d+)?\s*[〜～\-ー]\s*\d+(?:\.\d+)?\s*日/u, expected),
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

function stripThinkBlocksOutsideCodeFences(rawText: string): string {
  const output: string[] = []
  let outsideFenceBuffer = ""
  let inCodeFence = false
  let fenceMarker = ""
  let fenceLength = 0

  const flushOutsideFenceBuffer = (): boolean => {
    const withoutClosedBlocks = outsideFenceBuffer.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    const unclosedThinkIndex = withoutClosedBlocks.search(/<think\b[^>]*>/i)

    output.push(
      unclosedThinkIndex === -1 ? withoutClosedBlocks : withoutClosedBlocks.slice(0, unclosedThinkIndex),
    )
    outsideFenceBuffer = ""

    return unclosedThinkIndex === -1
  }

  const lines = rawText.match(/[^\n]*(?:\n|$)/g) ?? []

  for (const line of lines) {
    if (line.length === 0) {
      continue
    }

    const openingFence = line.match(/^\s*(`{3,}|~{3,})/)
    const closingFence =
      inCodeFence && line.match(new RegExp(`^\\s*\\${fenceMarker}{${fenceLength},}\\s*$`))

    if (!inCodeFence && openingFence) {
      if (!flushOutsideFenceBuffer()) {
        break
      }

      inCodeFence = true
      fenceMarker = openingFence[1][0]
      fenceLength = openingFence[1].length
      output.push(line)
      continue
    }

    if (inCodeFence) {
      output.push(line)

      if (closingFence) {
        inCodeFence = false
        fenceMarker = ""
        fenceLength = 0
      }

      continue
    }

    outsideFenceBuffer += line
  }

  if (outsideFenceBuffer.length > 0) {
    flushOutsideFenceBuffer()
  }

  return output.join("")
}

function stripLeadingThoughtExplanation(text: string): string {
  const withoutThoughtLabel = text.replace(
    /^\s*(?:思考|内部推論|推論|thinking|thought)\s*[:：]\s*[\s\S]{0,400}?(?:\n\s*\n|(?:回答|返信|返答|answer)\s*[:：]\s*)/iu,
    "",
  )

  return withoutThoughtLabel.replace(
    /^\s*(?:まず、?|最初に、?|はじめに、?)?(?:ユーザー|利用者|相談者|問い合わせ|メッセージ|依頼)(?:から|の)?[\s\S]{0,240}?(?:\n\s*\n|(?:回答|返信|返答)\s*[:：]\s*)/u,
    "",
  )
}
