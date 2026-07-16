import type { JobKind } from "@/lib/chatbot/domain/workflow-estimate"

export type SurveyChoice = {
  id: string
  label: string
}

export type SurveyChoiceSet = {
  id: string
  question: string
  choices: SurveyChoice[]
  selectionMode?: "single" | "multiple"
  allowFreeText?: boolean
}

export const SATOSHI_STUDIO_AVAILABLE_FROM_JST = "2026-09-15T00:00:00+09:00"

export const jobKindChoices = {
  id: "job-kind",
  question: "まず案件種別を選んでください",
  choices: [
    { id: "cm-30s", label: "Web CM / CM" },
    { id: "mv-5m", label: "MV / 音楽映像" },
    { id: "feature-90m", label: "映画 / 長編 / 本編" },
    { id: "drama-first", label: "ドラマ / シリーズ" },
    { id: "live-60m", label: "ライブ / コンサート / 舞台収録" },
    { id: "vertical-60s", label: "縦型動画 / SNS動画" },
    { id: "corporate-video", label: "企業VP / 採用動画 / 広報動画" },
    { id: "event-video", label: "イベント映像" },
    { id: "lecture-training", label: "講演会 / 講習会 / 教育 / 研修 / 講師依頼" },
    { id: "film-look-consultation", label: "フィルムルック / ルック設計相談" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export const projectLengthChoices = {
  id: "project-length",
  question: "尺・分量の大枠を選んでください",
  choices: [
    { id: "short-under-60s", label: "60秒以内" },
    { id: "medium-5m", label: "5分前後" },
    { id: "long-30m", label: "30分前後" },
    { id: "feature-90m", label: "90分前後" },
    { id: "live-60m", label: "ライブ 60分前後" },
    { id: "live-150m", label: "ライブ 150分前後" },
    { id: "undecided", label: "未定" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export const cmProjectLengthChoices = {
  id: "project-length",
  question: "CM / Web CM の尺・本数を選んでください",
  choices: [
    { id: "cm-length-15s", label: "15秒" },
    { id: "cm-length-30s", label: "30秒" },
    { id: "cm-length-60s", label: "60秒" },
    { id: "cm-length-multiple", label: "複数本" },
    { id: "undecided", label: "未定・相談したい" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export const mvProjectLengthChoices = {
  id: "project-length",
  question: "MV / 音楽映像の尺を選んでください",
  choices: [
    { id: "mv-length-3-5m", label: "3〜5分" },
    { id: "mv-length-5-10m", label: "5〜10分" },
    { id: "mv-length-over-10m", label: "10分以上" },
    { id: "undecided", label: "未定・相談したい" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export const dramaProjectLengthChoices = {
  id: "project-length",
  question: "ドラマ / シリーズの尺・話数を選んでください",
  choices: [
    { id: "drama-episode-under-15m", label: "1話15分以内" },
    { id: "drama-episode-30m", label: "1話30分前後" },
    { id: "drama-episode-45-60m", label: "1話45〜60分" },
    { id: "drama-series-total", label: "話数・全体尺を相談したい" },
    { id: "undecided", label: "未定・相談したい" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export const liveProjectLengthChoices = {
  id: "project-length",
  question: "ライブ / 舞台収録の尺を選んでください",
  choices: [
    { id: "live-length-30m", label: "30分" },
    { id: "live-length-60m", label: "60分" },
    { id: "live-length-90m", label: "90分" },
    { id: "live-length-over-120m", label: "2時間以上" },
    { id: "undecided", label: "未定・相談したい" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export const featureProjectLengthChoices = {
  id: "project-length",
  question: "映画 / 長編 / 本編の尺を選んでください",
  choices: [
    { id: "feature-length-under-60m", label: "60分未満" },
    { id: "feature-length-90m", label: "90分前後" },
    { id: "feature-length-over-120m", label: "120分以上" },
    { id: "undecided", label: "未定・相談したい" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export const verticalProjectLengthChoices = {
  id: "project-length",
  question: "縦型動画 / SNS動画の尺・本数を選んでください",
  choices: [
    { id: "vertical-length-15s", label: "15秒" },
    { id: "vertical-length-30s", label: "30秒" },
    { id: "vertical-length-60s", label: "60秒" },
    { id: "vertical-length-multiple", label: "複数本" },
    { id: "undecided", label: "未定・相談したい" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export const contextualProjectLengthChoices = [
  cmProjectLengthChoices,
  mvProjectLengthChoices,
  dramaProjectLengthChoices,
  liveProjectLengthChoices,
  featureProjectLengthChoices,
  verticalProjectLengthChoices,
] as const satisfies readonly SurveyChoiceSet[]

export function projectLengthChoicesForJobKind(jobKind: JobKind | undefined): SurveyChoiceSet {
  switch (jobKind) {
    case "cm-30s":
      return cmProjectLengthChoices
    case "mv-5m":
      return mvProjectLengthChoices
    case "drama-first":
    case "drama-follow-up":
      return dramaProjectLengthChoices
    case "live-60m":
      return liveProjectLengthChoices
    case "feature-90m":
      return featureProjectLengthChoices
    case "vertical-60s":
      return verticalProjectLengthChoices
    default:
      return projectLengthChoices
  }
}

export const finalMediumChoices = {
  id: "final-medium",
  question: "最終媒体を教えてください",
  choices: [
    { id: "ott", label: "OTT 配信" },
    { id: "cinema", label: "劇場公開" },
    { id: "tv-broadcast", label: "地上波放送" },
    { id: "live", label: "ライブ" },
    { id: "web", label: "Web" },
    { id: "vertical-sns", label: "縦型 SNS" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export const additionalWorkChoices = {
  id: "additional-work",
  question: "カラグレ以外の追加作業はありますか",
  selectionMode: "multiple",
  choices: [
    { id: "retouch", label: "消し物" },
    { id: "skin-retouch", label: "肌修正" },
    { id: "other", label: "その他" },
    { id: "none", label: "なし" },
  ],
} as const satisfies SurveyChoiceSet

export const documentaryAttachmentChoices = {
  id: "documentary-attachment",
  question: "付随する映像はありますか",
  selectionMode: "multiple",
  choices: [
    { id: "digest", label: "ダイジェスト" },
    { id: "interview", label: "インタビュー" },
    { id: "bonus", label: "特典映像" },
    { id: "making", label: "メイキング" },
    { id: "other", label: "その他" },
    { id: "none", label: "なし" },
  ],
} as const satisfies SurveyChoiceSet

export const workSiteChoices = {
  id: "work-site",
  question: "作業場所の希望はありますか",
  choices: [
    { id: "client-facility-attended", label: "クライアント施設立ち会い" },
    { id: "remote-grading", label: "リモートグレーディング" },
    { id: "on-site-post-production", label: "出張ポスプロ常駐" },
    { id: "satoshi-studio", label: "さとしさんのスタジオ" },
    { id: "entrust", label: "お任せ" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export function isSatoshiStudioCustomerFacingAvailable(now: Date = new Date()): boolean {
  return now.getTime() >= new Date(SATOSHI_STUDIO_AVAILABLE_FROM_JST).getTime()
}

export function customerFacingWorkSiteChoices(now: Date = new Date()): SurveyChoiceSet {
  if (isSatoshiStudioCustomerFacingAvailable(now)) return workSiteChoices
  return {
    ...workSiteChoices,
    choices: workSiteChoices.choices.filter((choice) => choice.id !== "satoshi-studio"),
  }
}

export const lectureTrainingContentChoices = {
  id: "lecture-training-content",
  question: "講習・教育で扱いたい内容を選んでください",
  selectionMode: "multiple",
  choices: [
    { id: "grading", label: "カラーグレーディング" },
    { id: "resolve-basic", label: "DaVinci Resolve 基礎" },
    { id: "look-design", label: "フィルムルック / ルック設計" },
    { id: "workflow", label: "ワークフロー相談" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export const lectureTrainingFormatChoices = {
  id: "lecture-training-format",
  question: "開催形式を選んでください",
  choices: [
    { id: "online", label: "オンライン" },
    { id: "in-person", label: "対面" },
    { id: "hybrid", label: "オンライン＋対面" },
    { id: "undecided", label: "未定" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export const lectureTrainingSoftwareChoices = {
  id: "lecture-training-software",
  question: "使用ソフトを選んでください",
  choices: [
    { id: "davinci-resolve-studio", label: "DaVinci Resolve Studio" },
    { id: "davinci-resolve", label: "DaVinci Resolve" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export const productionOptionChoices = {
  id: "production-options",
  question: "字幕・テロップ、ナレーション、音楽はありますか",
  selectionMode: "multiple",
  choices: [
    { id: "captions", label: "字幕" },
    { id: "telops", label: "テロップ" },
    { id: "narration", label: "ナレーション" },
    { id: "music", label: "音楽" },
    { id: "other", label: "その他" },
    { id: "none", label: "なし" },
  ],
} as const satisfies SurveyChoiceSet

export const bookingFinalConfirmationChoices = {
  id: "booking-final-confirmation",
  question: "ほかに確認したいこと、伝えておきたいこと、不安な点はありますか？",
  choices: [
    { id: "none", label: "なし、このまま進める" },
    { id: "other", label: "伝えたいこと・不安な点がある" },
  ],
} as const satisfies SurveyChoiceSet

export const surveyChoiceSets = [
  jobKindChoices,
  ...contextualProjectLengthChoices,
  projectLengthChoices,
  finalMediumChoices,
  additionalWorkChoices,
  documentaryAttachmentChoices,
  workSiteChoices,
  lectureTrainingContentChoices,
  lectureTrainingFormatChoices,
  lectureTrainingSoftwareChoices,
  productionOptionChoices,
  bookingFinalConfirmationChoices,
] as const satisfies readonly SurveyChoiceSet[]
