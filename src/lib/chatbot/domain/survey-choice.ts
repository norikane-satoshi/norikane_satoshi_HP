export type SurveyChoice = {
  id: string
  label: string
}

export type SurveyChoiceSet = {
  id: string
  question: string
  choices: SurveyChoice[]
  selectionMode?: "single" | "multiple"
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
  choices: [
    { id: "digest", label: "ダイジェスト" },
    { id: "interview", label: "インタビュー" },
    { id: "bonus", label: "特典映像" },
    { id: "making", label: "メイキング" },
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
    { id: "satoshi-studio", label: "さとしさんのスタジオ※10月以降" },
    { id: "entrust", label: "お任せ" },
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
    { id: "none", label: "なし" },
  ],
} as const satisfies SurveyChoiceSet

export const surveyChoiceSets = [
  finalMediumChoices,
  additionalWorkChoices,
  documentaryAttachmentChoices,
  workSiteChoices,
  productionOptionChoices,
] as const satisfies readonly SurveyChoiceSet[]
