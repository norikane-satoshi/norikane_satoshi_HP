import type { ConversationState, JobContext } from "@/lib/chatbot/domain"

export type ConsultationSummaryInput = {
  jobContext?: Partial<JobContext>
  conversationState?: Partial<ConversationState>
  fallback?: {
    customerName?: string
    companyName?: string
    contactEmail?: string
    jobKind?: string
    projectLength?: string
    publicReleaseDate?: string
  }
}

const missing = "未取得"

const finalMediumLabels: Record<NonNullable<JobContext["finalMedium"]>, string> = {
  ott: "OTT / 配信",
  cinema: "劇場",
  "tv-broadcast": "TV放送",
  live: "ライブ",
  web: "Web",
  "vertical-sns": "縦型SNS",
  other: "その他",
}

const jobKindLabels: Record<NonNullable<JobContext["jobKind"]>, string> = {
  "cm-30s": "CM 30秒",
  "mv-5m": "MV 5分",
  "feature-90m": "長編 90分",
  "drama-first": "ドラマ初回",
  "drama-follow-up": "ドラマ継続回",
  "vertical-60s": "縦型 60秒",
  "live-60m": "ライブ 60分",
}

const workSiteLabels: Record<NonNullable<JobContext["workSite"]>, string> = {
  "satoshi-studio": "のりかね映像設計室",
  "remote-grading": "リモート",
  "on-site": "現地",
}

const additionalWorkLabels: Record<NonNullable<JobContext["additionalWork"]>[number], string> = {
  retouch: "レタッチ",
  "skin-retouch": "肌レタッチ",
  other: "その他",
}

export function formatConsultationSummary(input: ConsultationSummaryInput): string {
  const jobContext = input.jobContext ?? {}
  const conversationState = input.conversationState ?? {}
  const fallback = input.fallback ?? {}

  return [
    "相談サマリ",
    `最終媒体: ${conversationState.hasFinalMedium ? labelFinalMedium(jobContext.finalMedium) : missing}`,
    "作業内容:",
    `- 案件種別: ${conversationState.hasJobKind ? labelJobKind(jobContext.jobKind, fallback.jobKind) : missing}`,
    `- 尺: ${formatValue(formatProjectLength(jobContext.projectLengthMinutes, fallback.projectLength))}`,
    `- 追加作業: ${conversationState.hasAdditionalWork ? labelAdditionalWork(jobContext.additionalWork) : missing}`,
    `- 付随素材: ${
      conversationState.hasDocumentaryAttachments ? labelDocumentaryAttachment(jobContext.documentaryAttachment) : missing
    }`,
    "作業場所・立ち会い:",
    `- 作業場所/立ち会い: ${conversationState.hasWorkSite ? labelWorkSite(jobContext.workSite) : missing}`,
    "希望日時:",
    `- 開始希望: ${conversationState.hasDesiredSchedule ? formatValue(jobContext.preferredStartDate) : missing}`,
    `- 公開/納品時期: ${
      conversationState.hasDesiredSchedule ? formatValue(jobContext.publicReleaseDate ?? fallback.publicReleaseDate) : missing
    }`,
    "連絡先:",
    `- 氏名: ${formatContactValue(conversationState.customerName ?? fallback.customerName)}`,
    `- 会社: ${formatContactValue(conversationState.companyName ?? fallback.companyName)}`,
    `- メール: ${formatValue(conversationState.contactEmail ?? fallback.contactEmail)}`,
  ].join("\n")
}

export function hasRequiredConsultationNotificationSlots(input: {
  conversationState?: Partial<ConversationState>
}): boolean {
  const state = input.conversationState ?? {}
  return Boolean(
    state.hasFinalMedium &&
      state.hasJobKind &&
      state.hasWorkSite &&
      state.hasDesiredSchedule &&
      state.hasContactEmail &&
      state.contactEmail,
  )
}

export function hasRequiredEmailConsultationSlots(input: {
  conversationState?: Partial<ConversationState>
}): boolean {
  const state = input.conversationState ?? {}
  return Boolean(
    state.hasFinalMedium &&
      state.hasJobKind &&
      state.hasWorkSite &&
      state.hasContactEmail &&
      state.contactEmail,
  )
}

function labelFinalMedium(value: JobContext["finalMedium"] | undefined): string {
  return value ? finalMediumLabels[value] : missing
}

function labelJobKind(value: JobContext["jobKind"] | undefined, fallback: string | undefined): string {
  if (value) return jobKindLabels[value]
  return formatValue(fallback)
}

function labelWorkSite(value: JobContext["workSite"] | undefined): string {
  return value ? workSiteLabels[value] : missing
}

function labelAdditionalWork(value: JobContext["additionalWork"] | undefined): string {
  if (!value || value.length === 0) return missing
  return value.map((item) => additionalWorkLabels[item]).join(" / ")
}

function labelDocumentaryAttachment(value: JobContext["documentaryAttachment"] | undefined): string {
  if (!value) return missing
  if (value.kind === "none") return "なし"
  const base = `${documentaryAttachmentKindLabel(value.kind)} ${value.count}件`
  return value.kind === "other" && value.note.trim() ? `${base}（${value.note.trim()}）` : base
}

function documentaryAttachmentKindLabel(kind: Exclude<JobContext["documentaryAttachment"]["kind"], "none">): string {
  switch (kind) {
    case "digest":
      return "ダイジェスト"
    case "interview":
      return "インタビュー"
    case "bonus":
      return "特典"
    case "making":
      return "メイキング"
    case "other":
      return "その他"
  }
}

function formatProjectLength(minutes: number | undefined, fallback: string | undefined): string | undefined {
  if (typeof minutes === "number") return `${minutes}分`
  return fallback
}

function formatContactValue(value: string | undefined): string {
  if (!value || value.trim() === "") return missing
  if (value === "provided") return "取得済み（具体名未転記）"
  return value
}

function formatValue(value: string | undefined): string {
  if (!value || value.trim() === "") return missing
  return value
}
