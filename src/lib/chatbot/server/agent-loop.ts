import type {
  ConversationState,
  JobContext,
  RoutingDecision,
  WorkflowEstimate,
} from "@/lib/chatbot/domain"
import type {
  ChatbotLlmRequest,
  ChatbotLlmResponse,
} from "@/lib/chatbot/server/llm-client"
import type { ChatbotLlmTierOrchestrator } from "@/lib/chatbot/server/llm-orchestrator"
import { createChatbotToolCallReadRequest } from "@/lib/chatbot/server/tool-call-reader"
import {
  dispatchChatbotToolCall,
  formatChatbotToolRegistryForPrompt,
  type ChatbotToolDispatchResult,
  type ChatbotToolExecutionContext,
  type ChatbotToolName,
} from "@/lib/chatbot/server/tool-dispatcher"
import { parseChatbotAgentToolCallJson } from "@/lib/chatbot/server/tool-json"

export const chatbotAgentLoopDefaults = {
  maxSteps: 3,
  timeoutMs: 45_000,
} as const

export type ChatbotAgentLoopStep = {
  step: number
  tool: string
  dispatchStatus: ChatbotToolDispatchResult["status"]
  fallbackReason?: Extract<ChatbotToolDispatchResult, { status: "fallback" }>["reason"] | "duplicate-side-effect"
}

export type ChatbotAgentLoopResult = {
  llmResponse: ChatbotLlmResponse
  routingDecision: RoutingDecision
  effectiveJobContext: JobContext
  toolDispatchResult?: ChatbotToolDispatchResult
  steps: ChatbotAgentLoopStep[]
  createdNotionAiThreadId?: string
}

type RunChatbotAgentLoopInput = {
  request: ChatbotLlmRequest
  orchestrator: ChatbotLlmTierOrchestrator
  generate?: (request: ChatbotLlmRequest) => Promise<ChatbotLlmResponse>
  resolveRoutingDecision: (response: ChatbotLlmResponse) => Promise<RoutingDecision>
  conversationState: ConversationState
  jobContext: JobContext
  latestUserMessage: string
  toolContext: ChatbotToolExecutionContext
  logger?: (message: string) => void
  maxSteps?: number
  timeoutMs?: number
}

const executableToolNames: ReadonlyArray<ChatbotToolName> = [
  "create_booking",
  "show_booking_card",
  "get_estimate",
  "ask_checkbox",
]
const executableToolNameSet = new Set<ChatbotToolName>(executableToolNames)
const sideEffectToolNames = new Set<string>(["create_booking"])

export async function runChatbotAgentLoop(
  input: RunChatbotAgentLoopInput,
): Promise<ChatbotAgentLoopResult> {
  return runChatbotAgentLoopInternal(input)
}

function buildAgentSystemPrompt(basePrompt: string): string {
  return [
    basePrompt,
    "会話スタイル:",
    "あなたは『のーちゃん』として、お客様の言葉をまず短く受け止め、要件整理と次の一問を自然な会話でつなぎます。",
    "定型文をそのまま返すのではなく、直前の発言に含まれる状況・不安・希望を1つ拾ってから返答します。",
    "情報を一方的に列挙せず、確認済みのことは短く認め、不明点は1〜2点に絞って質問します。",
    "料金・契約・安全分岐・境界ルールは既存ポリシーを優先し、柔らかい口調でも判断基準は変えません。",
    "エージェントモード:",
    "必要な場合だけ、本文の末尾に tool_call JSON オブジェクトを1つ置いてください。",
    "形式: {\"tool\":\"show_booking_card\",\"args\":{...}}",
    "通常の返答テキストと tool_call JSON は共存できます。tool_call JSON がある場合、アプリが dispatcher で実行し、結果を次ターンのコンテキストとして返します。",
    "ツール結果を受け取った後は、同じ副作用ツールを繰り返さず、お客様向けの最終回答テキストを返してください。",
    "安全分岐に該当する料金・契約・私生活・他案件・技術機密はツール化せず、アプリ層の direct-contact 判定に従います。",
    "利用可能ツール:",
    formatChatbotToolRegistryForPrompt(undefined, { enabledToolNames: executableToolNames }),
  ].join("\n")
}

async function runChatbotAgentLoopInternal(
  input: RunChatbotAgentLoopInput,
): Promise<ChatbotAgentLoopResult> {
  const generate = input.generate ?? ((request: ChatbotLlmRequest) => input.orchestrator.generate(request))
  const steps: ChatbotAgentLoopStep[] = []
  const executedSideEffects = new Set<string>()
  let effectiveJobContext = input.jobContext
  let request: ChatbotLlmRequest = {
    ...input.request,
    systemPrompt: buildAgentSystemPrompt(input.request.systemPrompt),
  }
  const timeoutMs = input.timeoutMs ?? chatbotAgentLoopDefaults.timeoutMs
  let response = await withTimeout(generate(request), timeoutMs)
  let createdNotionAiThreadId = extractCreatedNotionAiThreadId(response)
  let routingDecision = await input.resolveRoutingDecision(response)
  let toolDispatchResult: ChatbotToolDispatchResult | undefined
  let rawToolText = await resolveAgentToolCallRawText({
    rawText: response.rawText,
    response,
    routingDecision,
    request,
    orchestrator: input.orchestrator,
    generate,
    conversationState: input.conversationState,
    jobContext: effectiveJobContext,
    latestUserMessage: input.latestUserMessage,
    timeoutMs,
  })

  for (let stepIndex = 1; stepIndex <= (input.maxSteps ?? chatbotAgentLoopDefaults.maxSteps); stepIndex += 1) {
    const toolCall = parseChatbotAgentToolCallJson(rawToolText)
    if (!toolCall || toolCall.tool === "none") break

    if (sideEffectToolNames.has(toolCall.tool) && executedSideEffects.has(toolCall.tool)) {
      steps.push({
        step: stepIndex,
        tool: toolCall.tool,
        dispatchStatus: "fallback",
        fallbackReason: "duplicate-side-effect",
      })
      logAgentStep(input.logger, steps[steps.length - 1])
      break
    }

    toolDispatchResult = await handleAgentToolCall({
      tool: toolCall.tool,
      args: toolCall.args,
      routingDecision,
      context: input.toolContext,
      logger: input.logger,
    })

    const step: ChatbotAgentLoopStep = {
      step: stepIndex,
      tool: toolCall.tool,
      dispatchStatus: toolDispatchResult.status,
      ...(toolDispatchResult.status === "fallback" ? { fallbackReason: toolDispatchResult.reason } : {}),
    }
    steps.push(step)
    logAgentStep(input.logger, step)

    if (toolDispatchResult.status !== "executed") break
    if (sideEffectToolNames.has(toolDispatchResult.tool)) executedSideEffects.add(toolDispatchResult.tool)

    const toolRoutingDecision = routingDecisionFromToolResult(toolDispatchResult.result)
    if (toolRoutingDecision) routingDecision = toolRoutingDecision

    const toolEstimate = workflowEstimateFromToolResult(toolDispatchResult.result)
    if (toolEstimate) effectiveJobContext = { ...effectiveJobContext, workflowEstimate: toolEstimate }

    request = buildToolResultFeedbackRequest({
      previousRequest: request,
      previousResponse: response,
      toolResult: toolDispatchResult,
      routingDecision,
      effectiveJobContext,
    })
    try {
      response = await withTimeout(generate(request), timeoutMs)
    } catch (error) {
      ;(input.logger ?? console.info)(
        `[agent-loop] feedback-timeout reason=${error instanceof Error ? error.message : String(error)}`,
      )
      break
    }
    createdNotionAiThreadId = createdNotionAiThreadId ?? extractCreatedNotionAiThreadId(response)
    rawToolText = response.rawText
  }

  return {
    llmResponse: response,
    routingDecision,
    effectiveJobContext,
    ...(toolDispatchResult ? { toolDispatchResult } : {}),
    steps,
    ...(createdNotionAiThreadId ? { createdNotionAiThreadId } : {}),
  }
}

async function resolveAgentToolCallRawText(input: {
  rawText: string
  response: ChatbotLlmResponse
  routingDecision: RoutingDecision
  request: ChatbotLlmRequest
  orchestrator: ChatbotLlmTierOrchestrator
  generate: (request: ChatbotLlmRequest) => Promise<ChatbotLlmResponse>
  conversationState: ConversationState
  jobContext: JobContext
  latestUserMessage: string
  timeoutMs: number
}): Promise<string> {
  if (parseChatbotAgentToolCallJson(input.rawText)) return input.rawText
  if (!shouldReadToolCall(input.routingDecision, input.jobContext)) return input.rawText

  try {
    const response = await withTimeout(
      input.generate(
        createChatbotToolCallReadRequest({
          messages: input.request.messages,
          conversationState: input.conversationState,
          jobContext: input.jobContext,
          routingDecision: input.routingDecision,
          latestUserMessage: input.latestUserMessage,
          notionAiThread: resolveExistingNotionAiThread(input.request, input.response),
        }),
      ),
      input.timeoutMs,
    )
    return response.rawText
  } catch {
    return input.rawText
  }
}

function shouldReadToolCall(routingDecision: RoutingDecision, jobContext: JobContext): boolean {
  if (routingDecision.kind === "to-booking-inline") return true
  return Boolean(jobContext.jobKind)
}

async function handleAgentToolCall(input: {
  tool: string
  args: unknown
  routingDecision: RoutingDecision
  context: ChatbotToolExecutionContext
  logger?: (message: string) => void
}): Promise<ChatbotToolDispatchResult> {
  const safetyDenied = input.routingDecision.kind === "to-direct-contact"
  const logLine = `[tool] llm=${input.tool} safety=${input.routingDecision.kind} allowed=${!safetyDenied}`
  ;(input.logger ?? console.info)(logLine)

  if (!executableToolNameSet.has(input.tool as ChatbotToolName)) {
    return { status: "fallback", reason: "unknown-tool", tool: input.tool }
  }

  if (safetyDenied) {
    return { status: "fallback", reason: "safety-denied", tool: input.tool }
  }

  return dispatchChatbotToolCall({
    tool: input.tool,
    args: input.args,
    context: input.context,
  })
}

function buildToolResultFeedbackRequest(input: {
  previousRequest: ChatbotLlmRequest
  previousResponse: ChatbotLlmResponse
  toolResult: Extract<ChatbotToolDispatchResult, { status: "executed" }>
  routingDecision: RoutingDecision
  effectiveJobContext: JobContext
}): ChatbotLlmRequest {
  const notionAiThread = resolveExistingNotionAiThread(input.previousRequest, input.previousResponse)

  return {
    ...input.previousRequest,
    messages: [
      ...input.previousRequest.messages,
      { role: "assistant", content: input.previousResponse.rawText },
      {
        role: "system",
        content: [
          "tool_result:",
          JSON.stringify({
            tool: input.toolResult.tool,
            result: input.toolResult.result,
            routingDecision: input.routingDecision,
            jobContext: input.effectiveJobContext,
          }),
          "この結果を踏まえ、お客様向けの最終回答テキストを返してください。追加ツールが本当に必要な場合だけ tool_call JSON を1つ返してください。",
        ].join("\n"),
      },
    ],
    ...(notionAiThread ? { notionAiThread } : {}),
    forceFullPrompt: true,
  }
}

function resolveExistingNotionAiThread(
  request: ChatbotLlmRequest,
  response: ChatbotLlmResponse,
): { threadId: string } | undefined {
  const createdThreadId = extractCreatedNotionAiThreadId(response)
  if (createdThreadId) return { threadId: createdThreadId }
  const existingThreadId = request.notionAiThread?.threadId?.trim()
  return existingThreadId ? { threadId: existingThreadId } : undefined
}

function extractCreatedNotionAiThreadId(response: ChatbotLlmResponse): string | undefined {
  if (response.tier !== "tier-1-chrome-notion-ai") return undefined
  if (response.diagnostics?.notionAiThreadCreated !== true) return undefined
  const threadId = response.diagnostics.notionAiThreadId
  return typeof threadId === "string" && threadId.length > 0 ? threadId : undefined
}

function workflowEstimateFromToolResult(result: unknown): WorkflowEstimate | null {
  if (!result || typeof result !== "object") return null
  const workflowEstimate = (result as { workflowEstimate?: unknown }).workflowEstimate
  if (!workflowEstimate || typeof workflowEstimate !== "object") return null
  const totalMinDays = (workflowEstimate as { totalMinDays?: unknown }).totalMinDays
  const totalMaxDays = (workflowEstimate as { totalMaxDays?: unknown }).totalMaxDays
  return typeof totalMinDays === "number" && typeof totalMaxDays === "number"
    ? (workflowEstimate as WorkflowEstimate)
    : null
}

function routingDecisionFromToolResult(result: unknown): RoutingDecision | null {
  if (!result || typeof result !== "object") return null
  const routingDecision = (result as { routingDecision?: unknown }).routingDecision
  if (!routingDecision || typeof routingDecision !== "object") return null
  const kind = (routingDecision as { kind?: unknown }).kind
  if (kind !== "continue" && kind !== "to-booking-inline" && kind !== "to-email" && kind !== "to-direct-contact") {
    return null
  }
  return routingDecision as RoutingDecision
}

function logAgentStep(logger: ((message: string) => void) | undefined, step: ChatbotAgentLoopStep): void {
  ;(logger ?? console.info)(
    `[agent-loop] step=${step.step} tool=${step.tool} dispatch=${step.dispatchStatus}${
      step.fallbackReason ? ` reason=${step.fallbackReason}` : ""
    }`,
  )
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("chatbot_agent_loop_timeout")), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}
