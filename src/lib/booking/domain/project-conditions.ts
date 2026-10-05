import { formatDurationSeconds, formatWorkComposition, totalWorkCompositionSeconds, type WorkCompositionRow } from "./work-composition"
import { isCalendarDate } from "@/lib/chatbot/domain/deadline"

export type ConditionInput = "single" | "multiple" | "text" | "date" | "dates" | "number" | "composition"
export type ConditionOption = { id: string; label: string; aliases?: readonly string[] }
export type ConditionAnswer = {
  status?: "answered" | "unknown"
  selectedIds?: string[]
  text?: string
  number?: number
  date?: string
  dates?: string[]
  composition?: WorkCompositionRow[]
  otherComment?: string
  sourceMessageId?: string
}
export type ConditionAnswers = Record<string, ConditionAnswer>
export type ConditionVisibility = { all?: ConditionVisibility[]; any?: ConditionVisibility[]; questionId?: string; includes?: string[]; excludes?: string[] }
export type ProjectConditionDefinition = {
  id: string
  label: string
  question: string
  input: ConditionInput
  options: readonly ConditionOption[]
  allowFreeText?: boolean
  visibility?: ConditionVisibility
  detailLabels?: readonly string[]
  chatIntake?: boolean
  order?: number
  summary?: boolean
  unknownValue?: string
}

export const jobKindDefinition = {
  label: "案件種別",
  input: "single",
  id: "job-kind", chatIntake: true, order: 0,
  question: "まず案件種別を選んでください",
  options: [
    { id: "cm", label: "Web CM / CM" },
    { id: "mv", label: "MV / 音楽映像" },
    { id: "feature", label: "映画 / 長編 / 本編" },
    { id: "short-film", label: "短編映画" },
    { id: "documentary", label: "ドキュメンタリー" },
    { id: "drama", label: "ドラマ / シリーズ" },
    { id: "live", label: "ライブ / コンサート / 舞台収録" },
    { id: "vertical", label: "縦型動画 / SNS動画" },
    { id: "corporate-video", label: "企業VP / 採用動画 / 広報動画" },
    { id: "event-video", label: "イベント映像" },
    { id: "lecture-training", label: "講演会 / 講習会 / 教育 / 研修 / 講師依頼" },
    { id: "film-look-consultation", label: "フィルムルック / ルック設計相談" },
    { id: "other", label: "その他" },
  ],
} as const satisfies ProjectConditionDefinition

const finalMediumChoices = {
  label: "最終媒体",
  input: "multiple",
  id: "final-medium", chatIntake: true, order: 2,
  question: "最終媒体をすべて選んでください",
  options: [
    { id: "ott", label: "VOD・オンデマンド配信" },
    { id: "cinema", label: "劇場公開", aliases: ["劇場"] },
    { id: "tv-broadcast", label: "地上波・BS／CS放送" },
    { id: "blu-ray", label: "Blu-ray / ディスク" },
    { id: "youtube", label: "YouTube" },
    { id: "web", label: "Web公開" },
    { id: "vertical-sns", label: "縦型 SNS" },
    { id: "other", label: "その他" },
  ],
} as const satisfies ProjectConditionDefinition

const additionalWorkChoices = {
  label: "追加作業",
  input: "multiple",
  id: "additional-work", chatIntake: true, order: 6,
  question: "カラグレ以外の追加作業はありますか",
  options: [
    { id: "retouch", label: "消し物" },
    { id: "skin-retouch", label: "肌修正" },
    { id: "compositing", label: "合成" },
    { id: "other", label: "その他" },
    { id: "none", label: "なし" },
  ],
} as const satisfies ProjectConditionDefinition

const documentaryAttachmentChoices = {
  label: "付随素材",
  input: "multiple",
  id: "documentary-attachment", chatIntake: true, order: 8,
  question: "付随する映像はありますか",
  options: [
    { id: "digest", label: "ダイジェスト" },
    { id: "interview", label: "インタビュー" },
    { id: "bonus", label: "特典映像" },
    { id: "making", label: "メイキング" },
    { id: "other", label: "その他" },
    { id: "none", label: "なし" },
  ],
} as const satisfies ProjectConditionDefinition

const workSiteChoices = {
  label: "作業場所/立ち会い",
  input: "single",
  id: "work-site", chatIntake: true, order: 9,
  question: "立ち会い方法の希望はありますか",
  options: [
    { id: "remote-grading", label: "オンライン" },
    { id: "on-site", label: "先方の場所で" },
    { id: "none", label: "不要" },
    { id: "entrust", label: "お任せ" },
  ],
} as const satisfies ProjectConditionDefinition

const lectureTrainingContentChoices = {
  label: "講習内容",
  input: "multiple",
  visibility: { questionId: "job-kind", includes: ["lecture-training"] },
  id: "lecture-training-content",
  question: "講習・教育で扱いたい内容を選んでください",
  options: [
    { id: "grading", label: "カラーグレーディング" },
    { id: "resolve-basic", label: "DaVinci Resolve 基礎" },
    { id: "look-design", label: "フィルムルック / ルック設計" },
    { id: "workflow", label: "ワークフロー相談" },
    { id: "other", label: "その他" },
  ],
} as const satisfies ProjectConditionDefinition

const lectureTrainingFormatChoices = {
  label: "開催形式",
  input: "single",
  visibility: { questionId: "job-kind", includes: ["lecture-training"] },
  id: "lecture-training-format",
  question: "開催形式を選んでください",
  options: [
    { id: "online", label: "オンライン" },
    { id: "in-person", label: "対面" },
    { id: "hybrid", label: "オンライン＋対面" },
    { id: "undecided", label: "未定" },
    { id: "other", label: "その他" },
  ],
} as const satisfies ProjectConditionDefinition

const lectureTrainingSoftwareChoices = {
  label: "使用ソフト",
  input: "single",
  visibility: { questionId: "job-kind", includes: ["lecture-training"] },
  id: "lecture-training-software",
  question: "使用ソフトを選んでください",
  options: [
    { id: "davinci-resolve-studio", label: "DaVinci Resolve Studio" },
    { id: "davinci-resolve", label: "DaVinci Resolve" },
    { id: "other", label: "その他" },
  ],
} as const satisfies ProjectConditionDefinition

const productionOptionChoices = {
  label: "字幕・テロップ等",
  input: "multiple",
  id: "production-options",
  question: "字幕・テロップ、ナレーション、音楽はありますか",
  options: [
    { id: "captions", label: "字幕" },
    { id: "telops", label: "テロップ" },
    { id: "narration", label: "ナレーション" },
    { id: "music", label: "音楽" },
    { id: "other", label: "その他" },
    { id: "none", label: "なし" },
  ],
} as const satisfies ProjectConditionDefinition

const bookingFinalConfirmationChoices = {
  label: "最終確認",
  input: "single",
  summary: false,
  id: "booking-final-confirmation",
  question: "ほかに確認したいこと、伝えておきたいこと、不安な点はありますか？",
  options: [
    { id: "none", label: "なし、このまま進める" },
    { id: "other", label: "伝えたいこと・不安な点がある" },
  ],
} as const satisfies ProjectConditionDefinition

const materialTimingChoices = {
  label: "素材が揃う日",
  input: "date",
  id: "material-timing", chatIntake: true, order: 10,
  question: "編集確定版の素材が揃う日を選んでください。未定の場合は未定を選んでください。",
  options: [
    { id: "undecided", label: "未定" },
  ],
} as const satisfies ProjectConditionDefinition

const deliveryFormatChoices = {
  label: "納品形式",
  input: "text",
  id: "delivery-format", chatIntake: true, order: 3,
  question: "納品形式（コーデック・色空間）が分かれば教えてください。未定の場合は未定を選んでください。",
  allowFreeText: true,
  options: [{ id: "undecided", label: "未定" }],
} as const satisfies ProjectConditionDefinition

const dcpRequiredChoices = {
  label: "DCP必要性",
  input: "single",
  visibility: { questionId: "final-medium", includes: ["cinema"] },
  id: "dcp-required", chatIntake: true, order: 4,
  question: "劇場上映用のDCPは必要ですか？ 則兼はDCPを作成していないため、必要な場合はポスプロなど他社への依頼になります。",
  options: [
    { id: "required", label: "必要" },
    { id: "not-required", label: "不要" },
    { id: "undecided", label: "未定" },
  ],
} as const satisfies ProjectConditionDefinition

const dcpCreatorChoices = {
  label: "DCP作成担当",
  input: "text",
  visibility: { all: [{ questionId: "final-medium", includes: ["cinema"] }, { questionId: "dcp-required", excludes: ["not-required"] }] },
  id: "dcp-creator", chatIntake: true, order: 5,
  question: "DCPの作成担当を教えてください。則兼はDCPを作成していないため、他社へご依頼ください。未定の場合は未定を選んでください。",
  allowFreeText: true,
  options: [{ id: "undecided", label: "未定" }],
} as const satisfies ProjectConditionDefinition

const referenceUrlChoices = {
  label: "参考URL",
  input: "single",
  id: "reference-urls", chatIntake: true, order: 11,
  question: "事前に把握しておきたい参考URLがあれば教えてください",
  options: [
    { id: "none", label: "なし" },
    { id: "other", label: "URLを入力する" },
  ],
} as const satisfies ProjectConditionDefinition

const projectLengthChoices = {
  id: "project-length", chatIntake: true, order: 1, label: "作品構成", detailLabels: ["作品構成", "尺"],
  question: "作品ごとの名称、本数、尺を入力してください。未定の場合は未定を選んでください。",
  input: "composition", options: [{ id: "undecided", label: "未定" }],
} as const satisfies ProjectConditionDefinition
const retouchCutCount = {
  id: "retouch-cut-count", chatIntake: true, order: 7, label: "修正カット数", question: "修正が必要なカット数を入力してください。未定の場合は未定を選んでください。",
  input: "number", options: [{ id: "undecided", label: "未定" }],
  visibility: { questionId: "additional-work", includes: ["retouch", "skin-retouch", "compositing"] },
} as const satisfies ProjectConditionDefinition
const desiredDeliveryDate = { id: "desired-delivery-date", label: "納品希望日", question: "納品希望日を教えてください", input: "date", options: [] } as const satisfies ProjectConditionDefinition
const deliveryDateReason = { id: "delivery-date-reason", label: "納品希望日の理由", question: "納品希望日の理由を教えてください", input: "text", options: [] } as const satisfies ProjectConditionDefinition
const preferredDates = { id: "preferred-dates", label: "希望日", question: "作業希望日を教えてください", input: "dates", options: [], unknownValue: "未定（日程は則兼と相談）" } as const satisfies ProjectConditionDefinition
const unavailableDates = { id: "unavailable-dates", label: "都合の悪い日", question: "都合の悪い日を教えてください", input: "dates", options: [] } as const satisfies ProjectConditionDefinition

export const projectConditionDefinitions = [
  jobKindDefinition,
  projectLengthChoices,
  finalMediumChoices,
  deliveryFormatChoices,
  dcpRequiredChoices,
  dcpCreatorChoices,
  desiredDeliveryDate,
  deliveryDateReason,
  materialTimingChoices,
  preferredDates,
  unavailableDates,
  workSiteChoices,
  additionalWorkChoices,
  retouchCutCount,
  documentaryAttachmentChoices,
  productionOptionChoices,
  referenceUrlChoices,
  lectureTrainingContentChoices,
  lectureTrainingFormatChoices,
  lectureTrainingSoftwareChoices,
  bookingFinalConfirmationChoices
] as const satisfies readonly ProjectConditionDefinition[]
export type ProjectConditionId = typeof projectConditionDefinitions[number]["id"]
export type ProjectConditionLabel = typeof projectConditionDefinitions[number]["label"] | "尺"

export function getProjectConditionDefinition(id: string): ProjectConditionDefinition | undefined {
  return projectConditionDefinitions.find((definition) => definition.id === id)
}

export function isConditionVisible(definition: ProjectConditionDefinition, answers: ConditionAnswers): boolean {
  const evaluate = (rule: ConditionVisibility): boolean => {
    if (rule.all) return rule.all.every(evaluate)
    if (rule.any) return rule.any.some(evaluate)
    const answer = answers[rule.questionId ?? ""]
    const ids = answer?.status === "unknown" ? [] : answer?.selectedIds ?? []
    return (!rule.includes || rule.includes.some((id) => ids.includes(id))) && (!rule.excludes || !rule.excludes.some((id) => ids.includes(id)))
  }
  return !definition.visibility || evaluate(definition.visibility)
}

export type ConditionAnswerIssue = { path: string; message: string }
export type ConditionAnswersValidation = { success: true; data: ConditionAnswers } | { success: false; issues: ConditionAnswerIssue[] }

/** Validates the public ID contract and removes answers hidden by the current selection. */
export function validateConditionAnswers(value: unknown): ConditionAnswersValidation {
  const issues: ConditionAnswerIssue[] = []
  const data: ConditionAnswers = {}
  const object = (item: unknown): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item)
  const issue = (path: string, message: string) => issues.push({ path, message })
  if (!object(value)) return { success: false, issues: [{ path: "conditionAnswers", message: "Expected an object keyed by question ID" }] }
  for (const [id, raw] of Object.entries(value)) {
    const definition = getProjectConditionDefinition(id)
    if (!definition) { issue(id, "Unknown question ID"); continue }
    if (!object(raw)) { issue(id, "Expected an answer object"); continue }
    const allowed = new Set(["status", "selectedIds", "otherComment", "sourceMessageId", definition.input])
    if (definition.input === "single" || definition.input === "multiple") allowed.delete(definition.input)
    if (definition.input === "dates" || definition.allowFreeText || definition.options.some((option) => option.id === "other")) allowed.add("text")
    for (const key of Object.keys(raw)) if (!allowed.has(key)) issue(`${id}.${key}`, "Field does not match the question input")
    const answer: ConditionAnswer = {}
    if (raw.status !== undefined) {
      if (raw.status !== "answered" && raw.status !== "unknown") issue(`${id}.status`, "Unknown answer status")
      else answer.status = raw.status
    }
    for (const key of ["text", "otherComment", "sourceMessageId"] as const) {
      if (raw[key] === undefined) continue
      if (typeof raw[key] !== "string") issue(`${id}.${key}`, "Expected a string")
      else if (raw[key].trim()) answer[key] = raw[key].trim()
    }
    if (raw.selectedIds !== undefined) {
      if (!Array.isArray(raw.selectedIds) || !raw.selectedIds.every((optionId) => typeof optionId === "string" && definition.options.some((option) => option.id === optionId))) issue(`${id}.selectedIds`, "Unknown option ID")
      else {
        answer.selectedIds = [...new Set(raw.selectedIds)]
        if (definition.input !== "multiple" && answer.selectedIds.length > 1) issue(`${id}.selectedIds`, "Only one option is allowed")
        if (answer.selectedIds.includes("undecided") && answer.selectedIds.length > 1) issue(`${id}.selectedIds`, "Undecided cannot be combined with an answer")
      }
    }
    if (raw.date !== undefined) {
      if (typeof raw.date !== "string" || !isCalendarDate(raw.date)) issue(`${id}.date`, "Expected a calendar date in YYYY-MM-DD")
      else answer.date = raw.date
    }
    if (raw.dates !== undefined) {
      if (!Array.isArray(raw.dates) || !raw.dates.every((date) => typeof date === "string" && isCalendarDate(date))) issue(`${id}.dates`, "Expected calendar dates in YYYY-MM-DD")
      else answer.dates = [...new Set(raw.dates)]
    }
    if (raw.number !== undefined) {
      if (typeof raw.number !== "number" || !Number.isSafeInteger(raw.number) || raw.number < 0) issue(`${id}.number`, "Expected a nonnegative integer")
      else answer.number = raw.number
    }
    if (raw.composition !== undefined) {
      if (!Array.isArray(raw.composition) || raw.composition.length === 0) issue(`${id}.composition`, "Expected at least one work")
      else {
        const rows: WorkCompositionRow[] = []
        raw.composition.forEach((row, index) => {
          const path = `${id}.composition.${index}`
          if (!object(row) || Object.keys(row).some((key) => !["name", "count", "durationSeconds"].includes(key)) || (row.name !== undefined && typeof row.name !== "string") || typeof row.count !== "number" || !Number.isSafeInteger(row.count) || row.count <= 0 || (row.durationSeconds !== undefined && (typeof row.durationSeconds !== "number" || !Number.isSafeInteger(row.durationSeconds) || row.durationSeconds <= 0 || !Number.isSafeInteger(row.count * row.durationSeconds)))) { issue(path, "Expected a name, positive integer count and optional positive integer seconds"); return }
          rows.push({ ...(typeof row.name === "string" && row.name.trim() ? { name: row.name.trim() } : {}), count: row.count, ...(typeof row.durationSeconds === "number" ? { durationSeconds: row.durationSeconds } : {}) })
        })
        if (rows.every((row) => row.durationSeconds !== undefined) && rows.length && totalWorkCompositionSeconds(rows) === undefined) issue(`${id}.composition`, "Total duration exceeds safe integer seconds")
        answer.composition = rows
      }
    }
    data[id] = answer.status === "unknown" || answer.selectedIds?.includes("undecided") ? { status: "unknown", ...(answer.sourceMessageId ? { sourceMessageId: answer.sourceMessageId } : {}) } : answer
  }
  if (issues.length) return { success: false, issues }
  return { success: true, data: Object.fromEntries(Object.entries(data).filter(([id]) => isConditionVisible(getProjectConditionDefinition(id)!, data))) }
}

export function sanitizeConditionAnswers(value: unknown): ConditionAnswers {
  const result = validateConditionAnswers(value)
  if (!result.success) throw new TypeError(result.issues.map(({ path, message }) => `${path}: ${message}`).join("; "))
  return result.data
}

export function formatConditionAnswer(definition: ProjectConditionDefinition, answer: ConditionAnswer | undefined): string {
  const unknown = definition.unknownValue ?? "未確認"
  if (!answer || answer.status === "unknown" || answer.selectedIds?.includes("undecided")) return unknown
  if (definition.input === "composition") return formatWorkComposition(answer.composition ?? [])
  const labels = (answer.selectedIds ?? []).map((id) => definition.options.find((option) => option.id === id)?.label).filter((label): label is string => Boolean(label))
  const text = answer.text?.trim() || answer.date || answer.dates?.join(" / ")
  const number = answer.number !== undefined && Number.isSafeInteger(answer.number) && answer.number >= 0 ? String(answer.number) : undefined
  return [...labels, ...(text ? [text] : []), ...(number ? [number] : []), ...(answer.otherComment?.trim() ? [answer.otherComment.trim()] : [])].join(" / ") || unknown
}

export function projectConditionDetails(answers: ConditionAnswers): Array<{ label: ProjectConditionLabel; value: string }> {
  return projectConditionDefinitions.filter((definition) => !("summary" in definition && definition.summary === false)).flatMap<{ label: ProjectConditionLabel; value: string }>((definition) => {
    const value = isConditionVisible(definition, answers) ? formatConditionAnswer(definition, answers[definition.id]) : "未確認"
    if (definition.id === "project-length") {
      const seconds = totalWorkCompositionSeconds(answers[definition.id]?.composition ?? [])
      return [{ label: "作品構成" as const, value }, { label: "尺" as const, value: value === "未確認" || seconds === undefined ? "未確認" : formatDurationSeconds(seconds) }]
    }
    return [{ label: definition.label, value }]
  })
}
