import { confirmedBookingDetails } from "@/lib/chatbot/domain/booking-details"
import { jobKindLabels } from "@/lib/chatbot/domain/job-kind-label"
import { formatProjectLengthMinutes, parseProjectLengthMinutes } from "@/lib/chatbot/domain/project-length"
import type { ChatbotConversation, ConversationState, JobContext, WorkflowEstimate } from "@/lib/chatbot/domain"
import { estimateWorkflow, inferWorkflowJobContextFromText } from "@/lib/chatbot/server/duration-estimator"
import {
  getWorkflowDurationPresetsFromSnapshot,
  type ChatbotKnowledgeSnapshot,
} from "@/lib/chatbot/server/notion-knowledge-sync"

type WorkflowFactSnapshot = Pick<
  JobContext,
  "jobKind" | "finalMedium" | "deliveryMedium" | "workSite" | "projectLengthMinutes" | "additionalWork" | "attendanceDays"
>

export type DurationConversationState = {
  workflowFacts?: Partial<WorkflowFactSnapshot>
  workflowEstimate?: Pick<
    WorkflowEstimate,
    | "totalMinDays"
    | "totalMaxDays"
    | "riskFlags"
    | "estimateStatus"
    | "referencePresetId"
    | "referenceMinDays"
    | "referenceMaxDays"
    | "unsupportedReason"
  >
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
    deliveryMedium?: JobContext["deliveryMedium"]
    workSite: JobContext["workSite"]
    projectLengthMinutes?: number
    additionalWork?: JobContext["additionalWork"]
    workflowEstimate?: DurationConversationState["workflowEstimate"]
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
    ...input,
    ...stored,
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

  const facts = userTexts.reduce((current, text) => {
    const inferred = inferWorkflowJobContextFromText(text, current)
    if (Object.keys(inferred).length === 0) return current
    return {
      ...current,
      ...inferred,
    }
  }, base)
  const messages = [
    ...conversation.messages,
    ...(latestUserMessage ? [
      ...(conversation.context.currentQuestion ? [{ id: "duration-question", role: "assistant" as const, content: conversation.context.currentQuestion, createdAt: conversation.updatedAt }] : []),
      { id: "duration-latest", role: "user" as const, content: latestUserMessage, createdAt: conversation.updatedAt },
    ] : []),
  ]
  const value = confirmedBookingDetails({ messages, conversationState: conversation.context.conversationState }).find((detail) => detail.label === "尺")?.value
  return { ...facts, projectLengthMinutes: value ? parseProjectLengthMinutes(value) : undefined }
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

// Final medium and work site carry defaults until the customer answers, so they are only stated
// once confirmed; otherwise the model treats the defaults as the customer's answers.
export type ConfirmedWorkflowFacts = { finalMedium: boolean; workSite: boolean }

export function buildWorkflowPromptContext(
  jobContext: JobContext,
  confirmed: ConfirmedWorkflowFacts = { finalMedium: true, workSite: true },
): string | undefined {
  if (!jobContext.jobKind) return undefined

  const lines = [
    "現在の案件条件（会話からサーバー抽出）:",
    `- 案件種別: ${jobKindLabels[jobContext.jobKind]}`,
    `- 最終媒体: ${confirmed.finalMedium ? jobContext.finalMedium : "未確認"}`,
    `- 作業場所: ${confirmed.workSite ? jobContext.workSite : "未確認"}`,
  ]

  if (jobContext.deliveryMedium !== undefined) {
    lines.push(`- 納品媒体: ${jobContext.deliveryMedium}`)
  }
  lines.push(
    `- 尺: ${jobContext.projectLengthMinutes !== undefined ? formatMinutes(jobContext.projectLengthMinutes) : "未確認"}`,
  )

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
      deliveryMedium: jobContext.deliveryMedium,
      workSite: jobContext.workSite,
      projectLengthMinutes: jobContext.projectLengthMinutes,
      additionalWork: jobContext.additionalWork,
      ...(jobContext.attendanceDays !== undefined ? { attendanceDays: jobContext.attendanceDays } : {}),
    },
    ...(jobContext.workflowEstimate
      ? {
          workflowEstimate: {
            totalMinDays: jobContext.workflowEstimate.totalMinDays,
            totalMaxDays: jobContext.workflowEstimate.totalMaxDays,
            riskFlags: jobContext.workflowEstimate.riskFlags,
            estimateStatus: jobContext.workflowEstimate.estimateStatus,
            referencePresetId: jobContext.workflowEstimate.referencePresetId,
            referenceMinDays: jobContext.workflowEstimate.referenceMinDays,
            referenceMaxDays: jobContext.workflowEstimate.referenceMaxDays,
            unsupportedReason: jobContext.workflowEstimate.unsupportedReason,
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
        getWorkflowDurationPresetsFromSnapshot(input.knowledgeSnapshot).map((preset) => ({
          id: preset.id,
          minDays: preset.minDays,
          maxDays: preset.maxDays,
          source: "source" in preset && typeof preset.source === "string" ? preset.source : "static",
        })) ?? [],
    },
    jobContext: {
      jobKind: input.jobContext.jobKind,
      finalMedium: input.jobContext.finalMedium,
      deliveryMedium: input.jobContext.deliveryMedium,
      workSite: input.jobContext.workSite,
      projectLengthMinutes: input.jobContext.projectLengthMinutes,
      additionalWork: input.jobContext.additionalWork,
      workflowEstimate: input.jobContext.workflowEstimate
        ? {
            totalMinDays: input.jobContext.workflowEstimate.totalMinDays,
            totalMaxDays: input.jobContext.workflowEstimate.totalMaxDays,
            riskFlags: input.jobContext.workflowEstimate.riskFlags,
            estimateStatus: input.jobContext.workflowEstimate.estimateStatus,
            referencePresetId: input.jobContext.workflowEstimate.referencePresetId,
            referenceMinDays: input.jobContext.workflowEstimate.referenceMinDays,
            referenceMaxDays: input.jobContext.workflowEstimate.referenceMaxDays,
            unsupportedReason: input.jobContext.workflowEstimate.unsupportedReason,
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

function formatMinutes(value: number): string {
  if (value >= 60 && value % 60 === 0) return `${value / 60}時間`
  if (value > 60) return `${Math.floor(value / 60)}時間${value % 60}分`
  return formatProjectLengthMinutes(value)
}
