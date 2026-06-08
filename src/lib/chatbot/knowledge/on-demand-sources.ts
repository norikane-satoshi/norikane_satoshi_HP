import {
  candidateWindowGranularityByJobKind,
  workflowDurationPresets,
} from "@/lib/chatbot/knowledge/workflow-duration"
import { approvedSourceNotes } from "@/lib/chatbot/knowledge/source-notes"

export type ChatbotKnowledgeTopic =
  | "schedule"
  | "workflow"
  | "color-grading"
  | "color-correction"
  | "film-look"

export type ChatbotKnowledgeSource = {
  id: string
  title: string
  sourceUrl: string
  access: "notion-page" | "public-note"
  mirrorPath: string
  summary: string
  topics: readonly ChatbotKnowledgeTopic[]
  body?: string
}

const workflowDurationTable = workflowDurationPresets
  .map(
    (preset) =>
      `- ${preset.label}: ${preset.minDays}〜${preset.maxDays}日 / 候補提示単位: ${
        candidateWindowGranularityByJobKind[preset.id]
      }`,
  )
  .join("\n")

const correctionNote = approvedSourceNotes.find((note) => note.sourceUrl === "/notes/correction")

export const chatbotKnowledgeSources = [
  {
    id: "notion:chatbot-consultation-design",
    title: "AIチャットボット 相談窓口の設計",
    sourceUrl: "notion-page:AIチャットボット 相談窓口の設計",
    access: "notion-page",
    mirrorPath: "chatbot/AIチャットボット 相談窓口の設計.md",
    summary: "工程別日数テーブル、スケジュール感、候補提示単位、タイト日程時の導線判断の正本。",
    topics: ["schedule", "workflow"],
    body: `工程別日数テーブル（設計ページ実測値）:\n${workflowDurationTable}`,
  },
  {
    id: "notion:grading-decomposition",
    title: "カラーグレーディングの因数分解",
    sourceUrl: "notion-page:カラーグレーディングの因数分解",
    access: "notion-page",
    mirrorPath: "notes/カラーグレーディングの因数分解.md",
    summary: "グレーディングを作品全体・シーン・ショットの判断軸に分ける公開予定ノート。",
    topics: ["color-grading"],
  },
  {
    id: "notion:film-look",
    title: "フィルムルックについてわかっていること",
    sourceUrl: "notion-page:フィルムルックについてわかっていること",
    access: "notion-page",
    mirrorPath: "notes/フィルムルックについてわかっていること.md",
    summary: "フィルムルックを物理連鎖、濃度、色の混ざり、カーブ、グレインで説明する公開予定ノート。",
    topics: ["film-look", "color-grading"],
  },
  {
    id: correctionNote?.id ?? "public-note:color-correction",
    title: correctionNote?.title ?? "カラーコレクションの因数分解",
    sourceUrl: correctionNote?.sourceUrl ?? "/notes/correction",
    access: "public-note",
    mirrorPath: "notes/カラーコレクションの因数分解.md",
    summary: "ライブ等の大量カットで、露出・色味・カメラ差・作品ルックを粒度別に分ける考え方。",
    topics: ["color-correction", "color-grading", "workflow"],
    body: correctionNote?.body,
  },
] as const satisfies readonly ChatbotKnowledgeSource[]

export function buildChatbotKnowledgeIndexPrompt(): string {
  return [
    "知識索引（本文は常時同梱しない。必要時だけ Notion page または local mirror から該当詳細を参照）:",
    ...chatbotKnowledgeSources.map(
      (source) =>
        `- ${source.title}: ${source.summary} / topics=${source.topics.join(",")} / source=${source.sourceUrl} / mirror=${source.mirrorPath}`,
    ),
  ].join("\n")
}
