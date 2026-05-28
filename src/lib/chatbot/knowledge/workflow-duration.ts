import type { FinalMedium, JobKind, WorkSite } from "@/lib/chatbot/domain/workflow-estimate"

export const tightDeadlineThresholdDays = 3
export const tightishDeadlineMaxDays = 7
export const settledConversationTurnThreshold = 8
export const complexConversationTurnThreshold = 16

export type WorkflowDurationPreset = {
  id: JobKind
  label: string
  minDays: number
  maxDays: number
}

export const workflowDurationPresets = [
  { id: "cm-30s", label: "CM 30秒", minDays: 1, maxDays: 2 },
  { id: "mv-5m", label: "MV 5分", minDays: 2, maxDays: 2.5 },
  { id: "feature-90m", label: "本編 90分", minDays: 10, maxDays: 11 },
  { id: "drama-first", label: "ドラマ初回", minDays: 6, maxDays: 7 },
  { id: "drama-follow-up", label: "ドラマ 2話目以降", minDays: 5, maxDays: 5 },
  { id: "vertical-60s", label: "縦型 60秒", minDays: 1.5, maxDays: 1.5 },
  { id: "live-60m", label: "ライブ 60分", minDays: 7, maxDays: 8 },
] as const satisfies readonly WorkflowDurationPreset[]

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
    presetId: (typeof workflowDurationPresets)[number]["id"]
    baselineMinutes: number | undefined
  }
>

export const candidateWindowGranularityByJobKind = {
  "cm-30s": "1時間単位",
  "mv-5m": "1時間単位",
  "feature-90m": "日付単位",
  "drama-first": "日付単位",
  "drama-follow-up": "日付単位",
  "vertical-60s": "1時間単位",
  "live-60m": "日付単位",
} as const satisfies Record<JobKind, "1時間単位" | "日付単位">

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
