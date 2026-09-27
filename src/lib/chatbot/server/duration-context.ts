import { jobKindLabels } from "@/lib/chatbot/domain/job-kind-label"
import { formatProjectLengthMinutes } from "@/lib/chatbot/domain/project-length"
import { describeJobForEstimate, describeWorkflowStages, formatDayRange } from "@/lib/chatbot/knowledge/workflow-duration"
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
  if (jobContext.workflowEstimate) {
    if (jobContext.workflowEstimate.estimateStatus === "needs-confirmation") {
      const referenceMinDays = jobContext.workflowEstimate.referenceMinDays ?? jobContext.workflowEstimate.totalMinDays
      const referenceMaxDays = jobContext.workflowEstimate.referenceMaxDays ?? jobContext.workflowEstimate.totalMaxDays
      lines.push("- ライブ尺基準: 60分は約4日、150分は7〜8日程度。尺の増加は完全比例ではない。")
      lines.push(`- 今回尺の暫定上限目安: ${formatDayRange(referenceMinDays, referenceMaxDays)}`)
      lines.push("- 今回尺の確定日数: 150分超のため確認待ち")
      lines.push("- 禁止: 17〜20日などの正本にない日数レンジ、尺による線形倍率計算")
      lines.push("- 禁止: 顔ぼかし・追加補正・付随作業・ディスク納品を基本工程ラインに最初から込みと断定する表現")
      lines.push("- 納品形式: DVDという古い媒体名を回答側から新規に出さず、必要ならブルーレイディスクまたはディスク納品として確認する")
      lines.push("150分超は素材量・カメラ数・ぼかし箇所・チェック体制の確認を優先し、断定的な新規日数を発明しません。")
    } else {
      lines.push(
        `- 基本工程ライン: ${formatDayRange(
          jobContext.workflowEstimate.totalMinDays,
          jobContext.workflowEstimate.totalMaxDays,
        )}（${describeJobForEstimate(jobContext.jobKind, jobContext.projectLengthMinutes)}の目安）`,
      )
      const breakdown = describeWorkflowStages(jobContext.workflowEstimate.stages)
      if (breakdown) {
        const attendance = jobContext.workflowEstimate.attendanceDays
        lines.push(
          `- 工程の内訳: ${breakdown}（${
            attendance !== undefined
              ? `立ち会いはお客さまが${attendance}日を選択済み`
              : "立ち会い日数だけはお客さまが選ぶ。コンフォーム・仕込み・QC は則兼の作業日で、お客さまには「則兼の作業日」と伝える"
          }）`,
        )
      }
      // Only once the customer names such a delivery; otherwise the extra day is not brought up at all.
      if (jobContext.strictDeliveryClient) {
        lines.push("- 納品先: お客さまが NHK や OTT への納品と伝えているため、QC を1日多めに勧めている")
      }
      if (jobContext.jobKind === "live-60m") {
        lines.push("- ライブ尺基準: 60分は約4日、150分は7〜8日程度。尺の増加は完全比例ではない。")
        lines.push("- 禁止: 17〜20日などの過大見積もり、60分の単純2.5倍で10日とする線形倍率計算")
        lines.push("- 禁止: 顔ぼかし・追加補正・付随作業・ディスク納品を基本工程ラインに最初から込みと断定する表現")
        lines.push("- 納品形式: DVDという古い媒体名を回答側から新規に出さず、必要ならブルーレイディスクまたはディスク納品として確認する")
      }
      lines.push("このライン日数を正本ナレッジ由来の基本目安として扱い、追加作業・素材状況・希望納期・納品形式で前後または追加になる可能性を添えます。")
    }
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
