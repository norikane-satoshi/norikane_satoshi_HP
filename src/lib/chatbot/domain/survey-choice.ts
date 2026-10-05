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
  question: "立ち会い方法の希望はありますか",
  choices: [
    { id: "remote-grading", label: "オンライン" },
    { id: "on-site", label: "先方の場所で" },
    { id: "none", label: "不要" },
    { id: "entrust", label: "お任せ" },
  ],
} as const satisfies SurveyChoiceSet

export function customerFacingWorkSiteChoices(now: Date = new Date()): SurveyChoiceSet {
  void now
  return workSiteChoices
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

export const materialTimingChoices = {
  id: "material-timing",
  question: "編集確定版の素材が揃う日を選んでください。未定の場合は未定を選んでください。",
  choices: [
    { id: "undecided", label: "未定" },
  ],
} as const satisfies SurveyChoiceSet

export const deliveryFormatChoices = {
  id: "delivery-format",
  question: "納品形式（コーデック・色空間）が分かれば教えてください。未定の場合は未定を選んでください。",
  allowFreeText: true,
  choices: [{ id: "undecided", label: "未定" }],
} as const satisfies SurveyChoiceSet

export const dcpRequiredChoices = {
  id: "dcp-required",
  question: "劇場上映用のDCPは必要ですか？ 則兼はDCPを作成していないため、必要な場合はポスプロなど他社への依頼になります。",
  choices: [
    { id: "required", label: "必要" },
    { id: "not-required", label: "不要" },
    { id: "undecided", label: "未定" },
  ],
} as const satisfies SurveyChoiceSet

export const dcpCreatorChoices = {
  id: "dcp-creator",
  question: "DCPの作成担当を教えてください。則兼はDCPを作成していないため、他社へご依頼ください。未定の場合は未定を選んでください。",
  allowFreeText: true,
  choices: [{ id: "undecided", label: "未定" }],
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
  materialTimingChoices,
  deliveryFormatChoices,
  dcpRequiredChoices,
  dcpCreatorChoices,
  referenceUrlChoices,
  bookingFinalConfirmationChoices,
] as const satisfies readonly SurveyChoiceSet[]
