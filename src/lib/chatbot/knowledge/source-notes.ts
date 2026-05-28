export type ChatbotApprovedSourceNote = {
  id: string
  notionUrl: string
  title: string
  chatbotUse: string
  safeSummary: string
}

export const approvedSourceNotes = [
  {
    id: "1510399661d64891aee912320df39b91",
    notionUrl: "https://www.notion.so/1510399661d64891aee912320df39b91",
    title: "カラーコレクションの因数分解",
    chatbotUse: "カラーコレクションの価値説明と案件ヒアリングの背景知識",
    safeSummary:
      "カラーコレクションは複数カメラの露出・色味・肌色を整え、作品全体のベースラインを作る工程。抽象的な要望を粒度ごとに整理し、立ち会い時に素早く安全に返せる設計を重視する。",
  },
  {
    id: "2d61194573e140789602864a9040affe",
    notionUrl: "https://www.notion.so/2d61194573e140789602864a9040affe",
    title: "カラーグレーディングの因数分解",
    chatbotUse: "カラーグレーディングの相談受付で使う説明語彙",
    safeSummary:
      "カラーグレーディングは作品ごとのトーンを設計する工程。監督や担当者の抽象的な言葉を、色味・濃度・コントラスト・ベースバランスなどの相談しやすい軸に分けて合意形成する。",
  },
  {
    id: "7202c1ee64c04c97a4821b8e4f2e0f67",
    notionUrl: "https://www.notion.so/7202c1ee64c04c97a4821b8e4f2e0f67",
    title: "フィルムルックについてわかっていること",
    chatbotUse: "フィルムルック相談の公開可能な概念説明",
    safeSummary:
      "フィルムルックは雰囲気だけでなく、暗部の粘り、ハイライトの丸さ、色の混ざり方、粒の扱いなどの観点で相談できる。実装手順や内部手法名は出さず、作品の方向性確認に使う。",
  },
] as const satisfies readonly ChatbotApprovedSourceNote[]

export const approvedSourceNotesKnowledge = approvedSourceNotes
  .map((note) => `- ${note.title} (${note.id}): ${note.safeSummary}`)
  .join("\n")
