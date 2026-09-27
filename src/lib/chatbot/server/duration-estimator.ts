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
  shortDramaMaxEpisodeMinutes,
  standardDramaEpisodeMinutes,
  strictDeliveryMediums,
  workflowDurationJobKindMap,
  workflowDurationLengthAnchors,
  workflowDurationPresets as builtInWorkflowDurationPresets,
  workSiteDurationRules,
  type DayRange,
  type WorkflowDurationPresetId,
  type WorkflowStageDays,
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
  stages?: WorkflowStageDays
}

type PresetDays = DurationRange & { stages?: WorkflowStageDays }

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
  const presetDays = (presetId: WorkflowDurationPresetId): PresetDays => {
    // A snapshot synced before a line (or its stage columns) existed lacks it; the built-in line
    // stands in until the next sync.
    const builtIn = builtInWorkflowDurationPresets.find((item) => item.id === presetId)
    const preset =
      getWorkflowDurationPresetsFromSnapshot(options.knowledgeSnapshot).find((item) => item.id === presetId) ?? builtIn
    if (!preset) throw new Error(`Unknown workflow duration preset: ${presetId}`)
    const stages = ("stages" in preset && preset.stages) || builtIn?.stages
    return { minDays: preset.minDays, maxDays: preset.maxDays, ...(stages ? { stages } : {}) }
  }
  const length =
    typeof lengthMinutes === "number" && Number.isFinite(lengthMinutes) ? Math.max(0, lengthMinutes) : undefined

  if (jobKind === "live-60m" || jobKind === "feature-90m") {
    return estimateAnchoredDuration(workflowDurationLengthAnchors[jobKind], length, presetDays)
  }

  if ((jobKind === "drama-first" || jobKind === "drama-follow-up") && length !== undefined) {
    if (length <= shortDramaMaxEpisodeMinutes) {
      return { ...presetDays("drama-short"), note: "短尺ドラマ（1話あたり）の目安" }
    }
    if (length < standardDramaEpisodeMinutes.min || length > standardDramaEpisodeMinutes.max) {
      return {
        ...presetDays(workflowDurationJobKindMap[jobKind].presetId),
        note: `尺が基準（1話${standardDramaEpisodeMinutes.min}〜${standardDramaEpisodeMinutes.max}分）と異なるため要相談`,
      }
    }
  }

  const jobKindRule = workflowDurationJobKindMap[jobKind]
  return {
    ...presetDays(jobKindRule.presetId),
    ...(length !== undefined &&
    jobKindRule.baselineMinutes !== undefined &&
    length !== jobKindRule.baselineMinutes
      ? { note: "尺が基準と異なるため要相談" }
      : {}),
  }
}

function estimateAnchoredDuration(
  anchors: (typeof workflowDurationLengthAnchors)[keyof typeof workflowDurationLengthAnchors],
  length: number | undefined,
  presetDays: (presetId: WorkflowDurationPresetId) => PresetDays,
): BaseDurationRange {
  const short = { ...anchors.short, ...presetDays(anchors.short.presetId) }
  const long = { ...anchors.long, ...presetDays(anchors.long.presetId) }
  const minutes = length ?? short.minutes

  if (minutes <= short.minutes) {
    return {
      minDays: short.minDays,
      maxDays: short.maxDays,
      ...(short.stages ? { stages: short.stages } : {}),
      ...(minutes !== short.minutes ? { note: anchors.belowShortNote } : {}),
    }
  }

  if (minutes <= long.minutes) {
    const ratio = (minutes - short.minutes) / (long.minutes - short.minutes)
    const eased = 1 - (1 - ratio) ** 2

    const stages = short.stages && long.stages ? interpolateStages(short.stages, long.stages, eased) : undefined
    return {
      minDays: roundToHalf(short.minDays + (long.minDays - short.minDays) * eased),
      maxDays: roundToHalf(short.maxDays + (long.maxDays - short.maxDays) * eased),
      ...(stages ? { stages } : {}),
      ...(minutes !== long.minutes ? { note: `${short.minutes}分/${long.minutes}分アンカー間の緩やかな目安` } : {}),
    }
  }

  const extraRatio = Math.min((minutes - long.minutes) / long.minutes, 1)
  const maxDays = roundToHalf(Math.min(long.maxDays + 1, long.maxDays + extraRatio))

  return {
    minDays: long.minDays,
    maxDays,
    // The extra length is more preparation; the other stages stay as on the longer line.
    ...(long.stages
      ? {
          stages: {
            ...long.stages,
            prep: { ...long.stages.prep, maxDays: long.stages.prep.maxDays + (maxDays - long.maxDays) },
          },
        }
      : {}),
    note: anchors.aboveLongNote,
  }
}

function interpolateStages(short: WorkflowStageDays, long: WorkflowStageDays, eased: number): WorkflowStageDays {
  const between = (a: DayRange, b: DayRange): DayRange => ({
    minDays: roundToHalf(a.minDays + (b.minDays - a.minDays) * eased),
    maxDays: roundToHalf(a.maxDays + (b.maxDays - a.maxDays) * eased),
  })
  return {
    conform: between(short.conform, long.conform),
    prep: between(short.prep, long.prep),
    attendance: between(short.attendance, long.attendance),
    finish: between(short.finish, long.finish),
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

  const added = additionalWorkDays(jobContext)
  const addedDays = added.prepDays + added.finishDays

  return {
    minDays: base.minDays + addedDays,
    maxDays: base.maxDays + addedDays,
    heavyRetouch: false,
  }
}

/** Added work lands on a stage: retouch and attached videos are preparation, a strict medium's buffer is the check. */
function additionalWorkDays(jobContext: JobContext): { prepDays: number; finishDays: number } {
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
  return { prepDays: retouchDays + documentaryDays, finishDays: strictDeliveryDays }
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

  const stages = base.stages && !adjusted.heavyRetouch
    ? adjustStages(base.stages, jobContext)
    : undefined
  const attendanceDays = stages ? resolveAttendanceDays(stages.attendance, jobContext.attendanceDays) : undefined
  const note = [base.note, workSiteAdjusted.note].filter(Boolean).join(" / ") || undefined
  const totals = stages && attendanceDays !== undefined
    ? {
        totalMinDays: stages.conform.minDays + stages.prep.minDays + attendanceDays + stages.finish.minDays,
        totalMaxDays: stages.conform.maxDays + stages.prep.maxDays + attendanceDays + stages.finish.maxDays,
      }
    : { totalMinDays: workSiteAdjusted.minDays, totalMaxDays: workSiteAdjusted.maxDays }

  return {
    stages: stages
      ? [
          { stage: "conform", ...stages.conform },
          { stage: "prep", ...stages.prep },
          {
            stage: "attended",
            ...(attendanceDays !== undefined ? { minDays: attendanceDays, maxDays: attendanceDays } : stages.attendance),
          },
          { stage: "final-check", ...stages.finish },
        ]
      : [],
    ...totals,
    ...(attendanceDays !== undefined ? { attendanceDays } : {}),
    ...(note ? { note } : {}),
    riskFlags,
    ...getEstimateStatus(jobContext, base),
    ...(adjusted.heavyRetouch ? { requiresDirectContact: true } : {}),
  }
}

function adjustStages(stages: WorkflowStageDays, jobContext: JobContext): WorkflowStageDays {
  const added = additionalWorkDays(jobContext)
  const travel = workSiteDurationRules[jobContext.workSite]
  return {
    ...stages,
    prep: {
      minDays: stages.prep.minDays + added.prepDays + travel.travelMinDays,
      maxDays: stages.prep.maxDays + added.prepDays + travel.travelMaxDays,
    },
    finish: {
      minDays: stages.finish.minDays + added.finishDays,
      maxDays: stages.finish.maxDays + added.finishDays,
    },
  }
}

/** A chosen count within the job's attendance range; a job with one possible count has it fixed. */
function resolveAttendanceDays(range: DayRange, chosen: number | undefined): number | undefined {
  if (typeof chosen === "number" && Number.isFinite(chosen) && chosen >= range.minDays && chosen <= range.maxDays) {
    return chosen
  }
  return undefined
}

function getEstimateStatus(jobContext: JobContext, base: BaseDurationRange): Partial<WorkflowEstimate> {
  if (
    jobContext.jobKind === "live-60m" &&
    typeof jobContext.projectLengthMinutes === "number" &&
    jobContext.projectLengthMinutes > workflowDurationLengthAnchors["live-60m"].long.minutes
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
