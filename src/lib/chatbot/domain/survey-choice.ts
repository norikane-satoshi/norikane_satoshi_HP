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

export const projectLengthChoices: SurveyChoiceSet = {
  id: "project-length",
  question: "作品の尺を時間・分で入力してください。未定の場合は未定を選んでください。",
  choices: [],
}

export function projectLengthChoicesForJobKind(jobKind: JobKind | undefined): SurveyChoiceSet {
  void jobKind
  return projectLengthChoices
}

export const finalMediumChoices = {
  id: "final-medium",
  question: "最終媒体をすべて選んでください",
  selectionMode: "multiple",
  choices: [
    { id: "ott", label: "VOD・オンデマンド配信" },
    { id: "cinema", label: "劇場公開" },
    { id: "tv-broadcast", label: "地上波・BS／CS放送" },
    { id: "blu-ray", label: "Blu-ray / ディスク" },
    { id: "youtube", label: "YouTube" },
    { id: "web", label: "Web公開" },
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
  // The owner's studio is the first choice. Away from it, grading happens in a rented post-production
  // room, the client's own equipment room, or a space the client rents; never at the client's facility.
  choices: [
    { id: "satoshi-studio", label: "のりかね映像設計室スタジオ" },
    { id: "post-production-room", label: "ポスプロの部屋を借りる" },
    { id: "client-equipment-room", label: "依頼元の機材部屋（制作会社など）" },
    { id: "client-rental-space", label: "依頼元が手配するレンタルスペース" },
    { id: "remote-grading", label: "リモートグレーディング" },
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

// Material handoff and reference URL intake. The question texts must keep matching the
// material-handoff and reference-URL patterns, which read the answer against the previous question.
export const materialContentsChoices = {
  id: "material-contents",
  question: "何の素材をお送りいただく予定ですか？",
  selectionMode: "multiple",
  choices: [
    { id: "exported-video", label: "書き出し済みの映像" },
    { id: "camera-originals", label: "撮影素材一式" },
    { id: "selected-clips", label: "使用クリップのみ" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export const materialTimingChoices = {
  id: "material-timing",
  question: "その素材は、いつお送りいただけそうですか？",
  choices: [
    { id: "within-1-week", label: "1週間以内" },
    { id: "within-3-weeks", label: "2〜3週間以内" },
    { id: "over-1-month", label: "1か月以上先" },
    { id: "undecided", label: "未定" },
  ],
} as const satisfies SurveyChoiceSet

export const materialHandoffMethodChoices = {
  id: "material-handoff-method",
  question: "素材の受け渡し方法を教えてください。",
  choices: [
    { id: "uploader", label: "アップローダー" },
    { id: "drive-shipping", label: "SSD・HDDを郵送・バイク便" },
    { id: "hand-delivery", label: "手渡し" },
    { id: "other", label: "その他" },
  ],
} as const satisfies SurveyChoiceSet

export const referenceUrlChoices = {
  id: "reference-urls",
  question: "事前に把握しておきたい参考URLがあれば教えてください",
  choices: [
    { id: "none", label: "なし" },
    { id: "other", label: "URLを入力する" },
  ],
} as const satisfies SurveyChoiceSet

export const surveyChoiceSets = [
  jobKindChoices,
  projectLengthChoices,
  finalMediumChoices,
  additionalWorkChoices,
  documentaryAttachmentChoices,
  workSiteChoices,
  lectureTrainingContentChoices,
  lectureTrainingFormatChoices,
  lectureTrainingSoftwareChoices,
  productionOptionChoices,
  materialContentsChoices,
  materialTimingChoices,
  materialHandoffMethodChoices,
  referenceUrlChoices,
  bookingFinalConfirmationChoices,
] as const satisfies readonly SurveyChoiceSet[]
