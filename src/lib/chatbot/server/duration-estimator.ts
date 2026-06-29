import type {
  DocumentaryAttachment,
  DeliveryMedium,
  FinalMedium,
  JobContext,
  JobKind,
  WorkflowEstimate,
  WorkSite,
} from "@/lib/chatbot/domain"
import {
  additionalWorkDurationRules,
  liveDurationAnchors,
  strictDeliveryMediums,
  workflowDurationJobKindMap,
  workSiteDurationRules,
} from "@/lib/chatbot/knowledge/workflow-duration"
import {
  getWorkflowDurationPresetsFromSnapshot,
  type ChatbotKnowledgeSnapshot,
} from "@/lib/chatbot/server/notion-knowledge-sync"

type DurationRange = {
  minDays: number
  maxDays: number
}

type BaseDurationRange = DurationRange & {
  note?: string
}

type AdditionalWorkDurationRange = DurationRange & {
  heavyRetouch: boolean
}

type WorkSiteDurationRange = DurationRange & {
  note?: string
  canSkipFinalCheck?: boolean
}

type DurationEstimatorOptions = {
  knowledgeSnapshot?: ChatbotKnowledgeSnapshot | null
}

export type { JobKind }

export function inferWorkflowJobContextFromText(
  message: string | undefined,
  current: JobContext,
): Partial<JobContext> {
  if (!message) return {}

  const normalized = message.normalize("NFKC").toLowerCase()
  const explicitJobKind = inferJobKind(normalized)
  const explicitProjectLengthMinutes = inferProjectLengthMinutes(normalized)
  const safeExplicitJobKind =
    explicitJobKind && canInferExplicitJobKind(explicitJobKind, explicitProjectLengthMinutes)
      ? explicitJobKind
      : undefined
  const jobKind = current.jobKind ?? safeExplicitJobKind
  const canInferProjectLength =
    current.projectLengthMinutes === undefined &&
    Boolean(jobKind) &&
    (!current.jobKind || !explicitJobKind || explicitJobKind === current.jobKind)
  const projectLengthMinutes = canInferProjectLength ? explicitProjectLengthMinutes : undefined
  const finalMedium =
    current.finalMedium === "other" && !looksLikeJobKindChoiceOnly(normalized)
      ? inferFinalMedium(normalized)
      : undefined
  const deliveryMedium = current.deliveryMedium === undefined ? inferDeliveryMedium(normalized) : undefined
  const inferred: Partial<JobContext> = {}

  if (!current.jobKind && safeExplicitJobKind) inferred.jobKind = safeExplicitJobKind
  if (current.projectLengthMinutes === undefined && projectLengthMinutes !== undefined) {
    inferred.projectLengthMinutes = projectLengthMinutes
  }
  if (current.finalMedium === "other" && finalMedium) inferred.finalMedium = finalMedium
  if (current.deliveryMedium === undefined && deliveryMedium) inferred.deliveryMedium = deliveryMedium

  return inferred
}

function canInferExplicitJobKind(jobKind: JobKind, projectLengthMinutes: number | undefined): boolean {
  return workflowDurationJobKindMap[jobKind].baselineMinutes === undefined || projectLengthMinutes !== undefined
}

function looksLikeJobKindChoiceOnly(text: string): boolean {
  if (!/^\s*選択\s*[：:]/u.test(text)) return false
  if (!inferJobKind(text)) return false
  return !/(?:公開|納品|使用先|放送|配信|劇場|上映|web公開|youtube|sns|ott|プラットフォーム)/u.test(text)
}

function inferJobKind(text: string): JobKind | undefined {
  if (/(?:ライブ|live)/u.test(text)) return "live-60m"
  if (/(?:縦型|縦動画|縦長|shorts|reels|tiktok|vertical)/u.test(text)) return "vertical-60s"
  if (/(?:ドラマ|drama)/u.test(text)) {
    if (/(?:2話目以降|二話目以降|第?[2-9][0-9]*話|[2-9][0-9]*話目|続話|継続)/u.test(text)) {
      return "drama-follow-up"
    }
    if (/(?:初回|第?1話|1話目|一話目)/u.test(text)) return "drama-first"
    return "drama-first"
  }
  if (/(?:本編|長編|feature)/u.test(text)) return "feature-90m"
  if (/(?:ミュージックビデオ|music\s*video|(?:^|[^a-z0-9])mv(?:$|[^a-z0-9]))/u.test(text)) return "mv-5m"
  if (/(?:web\s*cm|ウェブ\s*cm|webコマーシャル|cm\s*\d|(?:^|[^a-z0-9])cm(?:$|[^a-z0-9])|コマーシャル)/u.test(text)) {
    return "cm-30s"
  }

  return undefined
}

function inferFinalMedium(text: string): FinalMedium | undefined {
  if (/(?:ott|配信|streaming)/u.test(text)) return "ott"
  if (/(?:劇場|映画館|cinema|theater)/u.test(text)) return "cinema"
  if (/(?:テレビ|tv|放送|地上波)/u.test(text)) return "tv-broadcast"
  if (/(?:ライブ|live)/u.test(text)) return "live"
  if (/(?:縦型|縦動画|縦長|shorts|reels|tiktok|vertical)/u.test(text)) return "vertical-sns"
  if (/(?:web|ウェブ|youtube|サイト|sns)/u.test(text)) return "web"
  return undefined
}

function inferProjectLengthMinutes(text: string): number | undefined {
  const hoursAndHalf = /(\d+(?:\.\d+)?)\s*時間\s*半/u.exec(text)
  if (hoursAndHalf) return Number(hoursAndHalf[1]) * 60 + 30

  const hoursAndMinutes = /(\d+(?:\.\d+)?)\s*(?:時間|h)(?:\s*(\d+(?:\.\d+)?)\s*分)?/u.exec(text)
  if (hoursAndMinutes) {
    return Number(hoursAndMinutes[1]) * 60 + (hoursAndMinutes[2] ? Number(hoursAndMinutes[2]) : 0)
  }

  const minutes = /(\d+(?:\.\d+)?)\s*(?:分|m(?:in)?(?:ute)?s?)/u.exec(text)
  if (minutes) return Number(minutes[1])

  const seconds = /(\d+(?:\.\d+)?)\s*(?:秒|s(?:ec(?:ond)?s?)?)/u.exec(text)
  if (seconds) return Number(seconds[1]) / 60

  return undefined
}

function inferDeliveryMedium(text: string): DeliveryMedium | undefined {
  if (/(?:dvd|blu-?ray|bd|ブルーレイ|ディスク)/u.test(text)) return "dvd"

  return undefined
}

export function estimateBaseDuration(
  jobKind: JobKind,
  lengthMinutes?: number,
  options: DurationEstimatorOptions = {},
): BaseDurationRange {
  if (jobKind === "live-60m") {
    return estimateLiveBaseDuration(lengthMinutes)
  }

  const jobKindRule = workflowDurationJobKindMap[jobKind]
  const workflowDurationPresets = getWorkflowDurationPresetsFromSnapshot(options.knowledgeSnapshot)
  const preset = workflowDurationPresets.find((item) => item.id === jobKindRule.presetId)

  if (!preset) {
    throw new Error(`Unknown workflow duration preset: ${jobKindRule.presetId}`)
  }

  return {
    minDays: preset.minDays,
    maxDays: preset.maxDays,
    ...(lengthMinutes !== undefined &&
    jobKindRule.baselineMinutes !== undefined &&
    lengthMinutes !== jobKindRule.baselineMinutes
      ? { note: "尺が基準と異なるため要相談" }
      : {}),
  }
}

function estimateLiveBaseDuration(lengthMinutes?: number): BaseDurationRange {
  const length =
    typeof lengthMinutes === "number" && Number.isFinite(lengthMinutes)
      ? Math.max(0, lengthMinutes)
      : liveDurationAnchors.sixtyMinutes.minutes
  const shortAnchor = liveDurationAnchors.sixtyMinutes
  const longAnchor = liveDurationAnchors.oneHundredFiftyMinutes

  if (length <= shortAnchor.minutes) {
    return {
      minDays: shortAnchor.minDays,
      maxDays: shortAnchor.maxDays,
      ...(length !== shortAnchor.minutes ? { note: "60分以下は60分ライブ基準" } : {}),
    }
  }

  if (length <= longAnchor.minutes) {
    const ratio = (length - shortAnchor.minutes) / (longAnchor.minutes - shortAnchor.minutes)
    const eased = 1 - (1 - ratio) ** 2

    return {
      minDays: roundToHalf(shortAnchor.minDays + (longAnchor.minDays - shortAnchor.minDays) * eased),
      maxDays: roundToHalf(shortAnchor.maxDays + (longAnchor.maxDays - shortAnchor.maxDays) * eased),
      ...(length !== longAnchor.minutes ? { note: "60分/150分アンカー間の緩やかな目安" } : {}),
    }
  }

  const extraRatio = Math.min((length - longAnchor.minutes) / longAnchor.minutes, 1)

  return {
    minDays: longAnchor.minDays,
    maxDays: roundToHalf(Math.min(9, longAnchor.maxDays + extraRatio)),
    note: "150分超は素材量・カメラ数・チェック体制の確認優先",
  }
}

function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2
}

export function applyAdditionalWorkAdjustment(
  base: DurationRange,
  jobContext: JobContext,
): AdditionalWorkDurationRange {
  if (jobContext.heavyRetouch) {
    return {
      ...base,
      heavyRetouch: true,
    }
  }

  const retouchDays = hasRetouchWork(jobContext)
    ? (jobContext.retouchCutCount ?? additionalWorkDurationRules.noAdditionalDays) /
      additionalWorkDurationRules.retouchCutsPerDay
    : additionalWorkDurationRules.noAdditionalDays
  const documentaryDays =
    getDocumentaryAttachmentCount(jobContext.documentaryAttachment) *
    additionalWorkDurationRules.documentaryAttachmentDaysPerVideo
  const strictDeliveryDays = isStrictDeliveryMedium(jobContext.finalMedium)
    ? additionalWorkDurationRules.strictMediumAdditionalDays
    : additionalWorkDurationRules.noAdditionalDays
  const addedDays = retouchDays + documentaryDays + strictDeliveryDays

  return {
    minDays: base.minDays + addedDays,
    maxDays: base.maxDays + addedDays,
    heavyRetouch: false,
  }
}

export function applyWorkSiteAdjustment(
  adjusted: DurationRange,
  workSite: WorkSite,
): WorkSiteDurationRange {
  const rule = workSiteDurationRules[workSite]

  return {
    minDays: adjusted.minDays + rule.travelMinDays,
    maxDays: adjusted.maxDays + rule.travelMaxDays,
    ...(workSite === "remote-grading" ? { note: "案件ごと上乗せ議論" } : {}),
    ...(rule.canSkipFinalCheckDayWithLocalHandoff ? { canSkipFinalCheck: true } : {}),
  }
}

export function estimateWorkflow(
  jobContext: JobContext,
  options: DurationEstimatorOptions = {},
): WorkflowEstimate {
  if (!jobContext.jobKind) {
    throw new Error("jobKind is required to estimate chatbot workflow duration")
  }

  const base = estimateBaseDuration(jobContext.jobKind, jobContext.projectLengthMinutes, options)
  const adjusted = applyAdditionalWorkAdjustment(base, jobContext)
  const workSiteAdjusted = applyWorkSiteAdjustment(adjusted, jobContext.workSite)
  const riskFlags: WorkflowEstimate["riskFlags"] = []

  if (adjusted.heavyRetouch) {
    riskFlags.push(additionalWorkDurationRules.heavyRetouchFlag)
  }
  if (isStrictDeliveryMedium(jobContext.finalMedium)) {
    riskFlags.push("strict-delivery")
  }
  if (workSiteAdjusted.canSkipFinalCheck) {
    riskFlags.push("on-site-transfer")
  }

  return {
    stages: [
      {
        stage: "attended",
        minDays: workSiteAdjusted.minDays,
        maxDays: workSiteAdjusted.maxDays,
        note: [base.note, workSiteAdjusted.note].filter(Boolean).join(" / ") || undefined,
      },
    ],
    totalMinDays: workSiteAdjusted.minDays,
    totalMaxDays: workSiteAdjusted.maxDays,
    riskFlags,
    ...getEstimateStatus(jobContext, base),
    ...(adjusted.heavyRetouch ? { requiresDirectContact: true } : {}),
  }
}

function getEstimateStatus(jobContext: JobContext, base: BaseDurationRange): Partial<WorkflowEstimate> {
  if (
    jobContext.jobKind === "live-60m" &&
    typeof jobContext.projectLengthMinutes === "number" &&
    jobContext.projectLengthMinutes > liveDurationAnchors.oneHundredFiftyMinutes.minutes
  ) {
    return {
      estimateStatus: "needs-confirmation",
      referencePresetId: "live-60m",
      referenceMinDays: base.minDays,
      referenceMaxDays: base.maxDays,
      unsupportedReason: "live-duration-outside-baseline",
    }
  }

  return { estimateStatus: "authoritative" }
}

function hasRetouchWork(jobContext: JobContext): boolean {
  return Boolean(
    jobContext.additionalWork?.some((item) => item === "retouch" || item === "skin-retouch"),
  )
}

function getDocumentaryAttachmentCount(attachment: DocumentaryAttachment): number {
  if (attachment.kind === "none") return additionalWorkDurationRules.noAdditionalDays
  if (attachment.kind === "mixed") {
    return attachment.items.reduce(
      (total, item) => total + (item.count ?? additionalWorkDurationRules.defaultDocumentaryAttachmentCount),
      0,
    )
  }
  return attachment.count ?? additionalWorkDurationRules.defaultDocumentaryAttachmentCount
}

function isStrictDeliveryMedium(finalMedium: FinalMedium): boolean {
  return (strictDeliveryMediums as readonly FinalMedium[]).includes(finalMedium)
}
