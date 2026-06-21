import type { ChatbotConversation, ConversationState, JobContext, WorkflowEstimate } from "@/lib/chatbot/domain"
import { estimateWorkflow, inferWorkflowJobContextFromText } from "@/lib/chatbot/server/duration-estimator"
import type { ChatbotKnowledgeSnapshot } from "@/lib/chatbot/server/notion-knowledge-sync"

type WorkflowFactSnapshot = Pick<
  JobContext,
  "jobKind" | "finalMedium" | "workSite" | "projectLengthMinutes" | "additionalWork"
>

export type DurationConversationState = {
  workflowFacts?: Partial<WorkflowFactSnapshot>
  workflowEstimate?: Pick<WorkflowEstimate, "totalMinDays" | "totalMaxDays" | "riskFlags">
  knowledgeSyncedAt?: string
  snapshotStatus: "current" | "missing"
}

export type DurationTraceContext = {
  knowledge: {
    syncedAt?: string
    workflowDurations: Array<{
      id: string
      minDays: number
      maxDays: number
      source: string
    }>
  }
  jobContext: {
    jobKind?: JobContext["jobKind"]
    finalMedium: JobContext["finalMedium"]
    workSite: JobContext["workSite"]
    projectLengthMinutes?: number
    additionalWork?: JobContext["additionalWork"]
    workflowEstimate?: Pick<WorkflowEstimate, "totalMinDays" | "totalMaxDays" | "riskFlags">
  }
}

export type WorkflowDurationContext = {
  jobContext: JobContext
  promptContext?: string
  conversationStatePatch: Partial<ConversationState>
  traceContext: DurationTraceContext
  hasNewFacts: boolean
}

export function resolveWorkflowDurationContext(input: {
  inputJobContext?: Partial<JobContext>
  conversation: ChatbotConversation
  activeChoiceJobContext?: Partial<JobContext>
  latestUserMessage?: string
  knowledgeSnapshot?: ChatbotKnowledgeSnapshot | null
}): WorkflowDurationContext {
  const base = buildBaseJobContext(input.inputJobContext, input.conversation, input.activeChoiceJobContext)
  const resolvedFacts = resolveWorkflowFactsFromConversation(base, input.conversation, input.latestUserMessage)
  const jobContext = provideWorkflowEstimate(resolvedFacts, input.knowledgeSnapshot)
  const durationState = buildDurationConversationState(jobContext, input.knowledgeSnapshot)

  return {
    jobContext,
    promptContext: buildWorkflowPromptContext(jobContext),
    conversationStatePatch: { durationContext: durationState },
    traceContext: buildDurationTraceContext({ jobContext, knowledgeSnapshot: input.knowledgeSnapshot }),
    hasNewFacts: hasNewWorkflowContextFact({
      inputJobContext: input.inputJobContext,
      conversation: input.conversation,
      activeChoiceJobContext: input.activeChoiceJobContext,
      jobContext,
    }),
  }
}

function buildBaseJobContext(
  input: Partial<JobContext> | undefined,
  conversation: ChatbotConversation,
  activeChoiceJobContext: Partial<JobContext> | undefined,
): JobContext {
  const stored = conversation.context.jobContext ?? {}
  const storedDurationFacts = conversation.context.conversationState?.durationContext?.workflowFacts ?? {}

  return {
    finalMedium: "other",
    workSite: "remote-grading",
    documentaryAttachment: { kind: "none" },
    ...storedDurationFacts,
    ...stored,
    ...input,
    ...activeChoiceJobContext,
  }
}

export function resolveWorkflowFactsFromConversation(
  base: JobContext,
  conversation: ChatbotConversation,
  latestUserMessage?: string,
): JobContext {
  const userTexts = [
    latestUserMessage,
    ...conversation.messages
      .filter((message) => message.role === "user")
      .reverse()
      .map((message) => message.content),
  ].filter((text): text is string => Boolean(text?.trim()))

  return userTexts.reduce((current, text) => {
    const inferred = inferWorkflowJobContextFromText(text, current)
    if (Object.keys(inferred).length === 0) return current
    return {
      ...current,
      ...inferred,
    }
  }, base)
}

export function provideWorkflowEstimate(
  jobContext: JobContext,
  knowledgeSnapshot?: ChatbotKnowledgeSnapshot | null,
): JobContext {
  if (!jobContext.jobKind) return jobContext

  try {
    return {
      ...jobContext,
      workflowEstimate: estimateWorkflow(jobContext, { knowledgeSnapshot }),
    }
  } catch {
    return jobContext
  }
}

export function buildWorkflowPromptContext(jobContext: JobContext): string | undefined {
  if (!jobContext.jobKind) return undefined

  const lines = [
    "現在の案件条件（会話からサーバー抽出）:",
    `- 案件種別: ${jobContext.jobKind}`,
    `- 最終媒体: ${jobContext.finalMedium}`,
    `- 作業場所: ${jobContext.workSite}`,
  ]

  if (jobContext.projectLengthMinutes !== undefined) {
    lines.push(`- 尺: ${formatMinutes(jobContext.projectLengthMinutes)}`)
  }
  if (jobContext.workflowEstimate) {
    lines.push(
      `- 基本工程ライン: ${formatDays(jobContext.workflowEstimate.totalMinDays)}〜${formatDays(
        jobContext.workflowEstimate.totalMaxDays,
      )}日`,
    )
    lines.push("このライン日数を正本ナレッジ由来の基準として扱い、追加作業・素材状況・希望納期で前後する説明を添えます。")
  }

  return lines.join("\n")
}

export function buildDurationConversationState(
  jobContext: JobContext,
  knowledgeSnapshot?: ChatbotKnowledgeSnapshot | null,
): DurationConversationState {
  return {
    workflowFacts: {
      jobKind: jobContext.jobKind,
      finalMedium: jobContext.finalMedium,
      workSite: jobContext.workSite,
      projectLengthMinutes: jobContext.projectLengthMinutes,
      additionalWork: jobContext.additionalWork,
    },
    ...(jobContext.workflowEstimate
      ? {
          workflowEstimate: {
            totalMinDays: jobContext.workflowEstimate.totalMinDays,
            totalMaxDays: jobContext.workflowEstimate.totalMaxDays,
            riskFlags: jobContext.workflowEstimate.riskFlags,
          },
        }
      : {}),
    ...(knowledgeSnapshot?.syncedAt ? { knowledgeSyncedAt: knowledgeSnapshot.syncedAt } : {}),
    snapshotStatus: knowledgeSnapshot ? "current" : "missing",
  }
}

export function buildDurationTraceContext(input: {
  jobContext: JobContext
  knowledgeSnapshot?: ChatbotKnowledgeSnapshot | null
}): DurationTraceContext {
  return {
    knowledge: {
      syncedAt: input.knowledgeSnapshot?.syncedAt,
      workflowDurations:
        input.knowledgeSnapshot?.workflowDurations.presets.map((preset) => ({
          id: preset.id,
          minDays: preset.minDays,
          maxDays: preset.maxDays,
          source: preset.source,
        })) ?? [],
    },
    jobContext: {
      jobKind: input.jobContext.jobKind,
      finalMedium: input.jobContext.finalMedium,
      workSite: input.jobContext.workSite,
      projectLengthMinutes: input.jobContext.projectLengthMinutes,
      additionalWork: input.jobContext.additionalWork,
      workflowEstimate: input.jobContext.workflowEstimate
        ? {
            totalMinDays: input.jobContext.workflowEstimate.totalMinDays,
            totalMaxDays: input.jobContext.workflowEstimate.totalMaxDays,
            riskFlags: input.jobContext.workflowEstimate.riskFlags,
          }
        : undefined,
    },
  }
}

function hasNewWorkflowContextFact(input: {
  inputJobContext: Partial<JobContext> | undefined
  conversation: ChatbotConversation
  activeChoiceJobContext: Partial<JobContext> | undefined
  jobContext: JobContext
}): boolean {
  const stored = input.conversation.context.jobContext
  const storedWorkflowFacts = input.conversation.context.conversationState?.durationContext?.workflowFacts
  const hasSource = <K extends keyof JobContext>(key: K) =>
    input.inputJobContext?.[key] !== undefined ||
    stored?.[key] !== undefined ||
    storedWorkflowFacts?.[key as keyof WorkflowFactSnapshot] !== undefined ||
    input.activeChoiceJobContext?.[key] !== undefined

  return (
    (Boolean(input.jobContext.jobKind) && !hasSource("jobKind")) ||
    (typeof input.jobContext.projectLengthMinutes === "number" && !hasSource("projectLengthMinutes")) ||
    (input.jobContext.finalMedium !== "other" && !hasSource("finalMedium"))
  )
}

function formatDays(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "")
}

function formatMinutes(value: number): string {
  if (value >= 60 && value % 60 === 0) return `${value / 60}時間`
  if (value > 60) return `${Math.floor(value / 60)}時間${value % 60}分`
  return `${value}分`
}
