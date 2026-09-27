import { formatProjectLengthMinutes } from "@/lib/chatbot/domain/project-length"
import type { FinalMedium, JobKind, WorkSite } from "@/lib/chatbot/domain/workflow-estimate"

export const tightDeadlineThresholdDays = 3
export const tightishDeadlineMaxDays = 7
export const settledConversationTurnThreshold = 8

/** A day range as customers read it: "1〜1.5日", or "1日" when both ends meet. */
export function formatDayRange(minDays: number, maxDays: number): string {
  const days = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, ""))
  return minDays === maxDays ? `${days(minDays)}日` : `${days(minDays)}〜${days(maxDays)}日`
}

export type WorkflowDurationPreset = {
  id: string
  label: string
  minDays: number
  maxDays: number
}

export const workflowDurationPresets = [
  { id: "cm-30s", label: "CM 30秒", minDays: 1, maxDays: 1 },
  { id: "mv-5m", label: "MV 5分", minDays: 1, maxDays: 1.5 },
  { id: "feature-90m", label: "本編 90分", minDays: 6, maxDays: 8 },
  { id: "feature-180m", label: "本編 3時間", minDays: 8, maxDays: 10 },
  { id: "drama-first", label: "ドラマ初回（1話45〜50分）", minDays: 6, maxDays: 7 },
  { id: "drama-follow-up", label: "ドラマ 2話目以降（1話45〜50分）", minDays: 5, maxDays: 5 },
  { id: "drama-short", label: "短尺ドラマ（1話5〜15分）", minDays: 1, maxDays: 2 },
  { id: "vertical-60s", label: "縦型 60秒", minDays: 1, maxDays: 1 },
  { id: "live-60m", label: "ライブ 60分", minDays: 4, maxDays: 4 },
  { id: "live-150m", label: "ライブ 150分", minDays: 7, maxDays: 8 },
] as const satisfies readonly WorkflowDurationPreset[]

export type WorkflowDurationPresetId = (typeof workflowDurationPresets)[number]["id"]

/**
 * Job kinds whose days grow with length: a length between the two anchors eases from one anchor's
 * days to the other's; outside them the nearer anchor holds, with a note that the length is off-table.
 */
export const workflowDurationLengthAnchors = {
  "live-60m": {
    short: { presetId: "live-60m", minutes: 60 },
    long: { presetId: "live-150m", minutes: 150 },
    belowShortNote: "60分以下は60分ライブ基準",
    aboveLongNote: "150分超は素材量・カメラ数・チェック体制の確認優先",
  },
  "feature-90m": {
    short: { presetId: "feature-90m", minutes: 90 },
    long: { presetId: "feature-180m", minutes: 180 },
    belowShortNote: "尺が基準と異なるため要相談",
    aboveLongNote: "3時間超は素材量・チェック体制の確認優先",
  },
} as const satisfies Partial<
  Record<
    JobKind,
    {
      short: { presetId: WorkflowDurationPresetId; minutes: number }
      long: { presetId: WorkflowDurationPresetId; minutes: number }
      belowShortNote: string
      aboveLongNote: string
    }
  >
>

/** Dramas are estimated per episode: up to this length an episode follows the short-drama line. */
export const shortDramaMaxEpisodeMinutes = 20
export const standardDramaEpisodeMinutes = { min: 45, max: 50 } as const

export const workflowDurationJobKindMap = {
  "cm-30s": { presetId: "cm-30s", baselineMinutes: 0.5 },
  "mv-5m": { presetId: "mv-5m", baselineMinutes: 5 },
  "feature-90m": { presetId: "feature-90m", baselineMinutes: 90 },
  "drama-first": { presetId: "drama-first", baselineMinutes: undefined },
  "drama-follow-up": { presetId: "drama-follow-up", baselineMinutes: undefined },
  "vertical-60s": { presetId: "vertical-60s", baselineMinutes: 1 },
  "live-60m": { presetId: "live-60m", baselineMinutes: 60 },
} as const satisfies Record<
  JobKind,
  {
    presetId: WorkflowDurationPresetId
    baselineMinutes: number | undefined
  }
>

export const additionalWorkDurationRules = {
  noAdditionalDays: 0,
  retouchCutsPerDay: 70,
  documentaryAttachmentDaysPerVideo: 0.25,
  defaultDocumentaryAttachmentCount: 1,
  strictMediumAdditionalDays: 1,
  heavyRetouchFlag: "heavy-retouch",
} as const

export const strictDeliveryMediums = ["ott", "cinema", "tv-broadcast"] as const satisfies readonly FinalMedium[]

export const mediumStrictnessRank = [
  "ott",
  "cinema",
  "tv-broadcast",
  "live",
  "web",
  "vertical-sns",
] as const satisfies readonly FinalMedium[]

export const workSiteDurationRules = {
  "satoshi-studio": {
    label: "satoshi-studio = 基準",
    travelMinDays: 0,
    travelMaxDays: 0,
    defaultSameDuration: true,
    canSkipFinalCheckDayWithLocalHandoff: false,
  },
  "remote-grading": {
    label: "remote-grading = 同日数デフォルト・案件ごと上乗せ議論",
    travelMinDays: 0,
    travelMaxDays: 0,
    defaultSameDuration: true,
    canSkipFinalCheckDayWithLocalHandoff: false,
  },
  "on-site": {
    label: "on-site = 往復 0.5～1日・現地引き継ぎで最終チェック 1日スキップ可",
    travelMinDays: 0.5,
    travelMaxDays: 1,
    defaultSameDuration: false,
    canSkipFinalCheckDayWithLocalHandoff: true,
  },
} as const satisfies Record<
  WorkSite,
  {
    label: string
    travelMinDays: number
    travelMaxDays: number
    defaultSameDuration: boolean
    canSkipFinalCheckDayWithLocalHandoff: boolean
  }
>

const estimateSubjectLabels: Record<JobKind, string> = {
  "cm-30s": "CM",
  "mv-5m": "MV",
  "feature-90m": "長編",
  "drama-first": "ドラマ初回",
  "drama-follow-up": "ドラマ2話目以降",
  "vertical-60s": "縦型動画",
  "live-60m": "ライブ",
}

/**
 * What a duration estimate is for: the length the customer chose, or, while it is still open, the
 * reference length the estimate assumes stated as a condition rather than as the customer's length.
 */
export function describeJobForEstimate(jobKind: JobKind, projectLengthMinutes: number | undefined): string {
  const subject = estimateSubjectLabels[jobKind]
  const baselineMinutes = workflowDurationJobKindMap[jobKind].baselineMinutes
  if (baselineMinutes === undefined) {
    // Drama lengths are per episode, so say so rather than read as the whole series.
    return projectLengthMinutes === undefined
      ? subject
      : `${subject}（1話${formatProjectLengthMinutes(projectLengthMinutes)}）`
  }
  if (projectLengthMinutes !== undefined) return `${subject} ${formatProjectLengthMinutes(projectLengthMinutes)}`
  return `${subject}（${formatProjectLengthMinutes(baselineMinutes)}の場合）`
}
