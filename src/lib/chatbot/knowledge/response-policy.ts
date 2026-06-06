import { approvedSourceNotesKnowledge } from "@/lib/chatbot/knowledge/source-notes"
import { chatbotForbiddenTopics } from "@/lib/chatbot/knowledge/forbidden-topics"
import { satoshiProfileKnowledge } from "@/lib/chatbot/knowledge/satoshi-profile"
import { videoIndustryKnowledge } from "@/lib/chatbot/knowledge/video-industry"
import { featuredWorksKnowledge } from "@/lib/chatbot/knowledge/works"
import {
  candidateWindowGranularityByJobKind,
  workflowDurationPresets,
} from "@/lib/chatbot/knowledge/workflow-duration"

export const maxQuestionsPerAssistantResponse = 3
export const conversationRetentionDays = 7

export const chatbotPersonaPolicy = [
  "親しみやすい丁寧語の相棒型として、短く実務的に返す。",
  "営業トーク、過剰な断定、根拠のない賞賛を入れない。",
  "1返答で質問は最大3問までにする。",
] as const

export const initialIntakeQuestions = [
  "案件種類",
  "スケジュールがだいたい決まっているか",
  "お名前・会社名",
] as const

export function buildChatbotStaticPolicyPrompt(): string {
  return [
    "あなたは、のりかね映像設計室の新規映像案件の相談受付アシスタントです。",
    "Notionページを実行時に追加参照せず、下記の承認済み静的ルールだけで応答します。",
    "",
    "人格:",
    ...chatbotPersonaPolicy.map((item) => `- ${item}`),
    "",
    "初回基本3問:",
    `- ${initialIntakeQuestions.join(" / ")}`,
    "",
    "境界:",
    ...chatbotForbiddenTopics.map((topic) => `- ${topic.label}: ${topic.instruction}`),
    "- 技術指導、作品レビュー、標準外要望は本人確認へ誘導する。",
    "- 非公開手法の固有名、独自の内部手法の詳細、他案件情報は出さない。",
    "- カメラ種類、収録形式、解像度、フレームレート、Log / LUT は分かれば聞く程度にし、曖昧なら深追いしない。",
    "- 素材の搬入方法、納品形式、打ち合わせ希望、作業場所の希望は、カメラ種類より優先して確認する。",
    "- スケジュールがだいたい決まっている相談者には、詳細深掘りより先に空き状況の候補提示へ進む。",
    "",
    "料金:",
    "- どんな聞かれ方でも具体額、単価、概算、相場を出さない。",
    "- 料金は本人が案件詳細を確認して返答する。",
    "",
    "会話保持:",
    `- 会話状態は${conversationRetentionDays}日間保持する。`,
    "",
    "工程日数:",
    ...workflowDurationPresets.map(
      (preset) =>
        `- ${preset.label}: ${preset.minDays}〜${preset.maxDays}日 / 候補提示単位: ${
          candidateWindowGranularityByJobKind[preset.id]
        }`,
    ),
    "",
    "Approved source notes:",
    approvedSourceNotesKnowledge,
    "",
    "対応範囲ナレッジ:",
    satoshiProfileKnowledge.trim(),
    "",
    "Works / 実績ナレッジ:",
    featuredWorksKnowledge.trim(),
    "",
    "映像領域ナレッジ:",
    videoIndustryKnowledge.trim(),
  ].join("\n")
}

export function enforceAssistantQuestionLimit(content: string): string {
  const segments = content.match(/[^。！？!?]+[。！？!?]?/g) ?? [content]
  let questionCount = 0
  const kept: string[] = []

  for (const segment of segments) {
    const isQuestion = /[？?]/.test(segment)
    if (isQuestion) {
      questionCount += 1
      if (questionCount > maxQuestionsPerAssistantResponse) continue
    }
    kept.push(segment)
  }

  return kept.join("").trim()
}

export function removeForbiddenAssistantSurface(content: string): string {
  return stripInternalAssistantMarkup(content)
    .replace(
      new RegExp(`${["L", "OOK"].join("")}\\s*${["De", "composer"].join("")}\\s*v?2?`, "gi"),
      "非公開の内部手法",
    )
    .replace(new RegExp(`${["L", "ook"].join("")}\\s*${["De", "composition"].join("")}`, "gi"), "ルックの整理手法")
    .replace(/busy\s*時間帯/giu, "予約が埋まっている時間帯")
    .replace(/Free\/Busy/gi, "空き状況")
    .replace(/LLM/gi, "AI")
    .replace(/R\s*A\s*G/gi, "参照情報")
    .replace(/ぜひ(?:弊社|当方|私たち|お任せください)[^。！？!?]*[。！？!?]?/g, "")
    .trim()
}

export function stripInternalAssistantMarkup(content: string): string {
  return content
    .replace(/<\s*lang\b[^>]*\/\s*>/giu, "")
    .replace(/<\s*lang\b[^>]*>[\s\S]*?<\s*\/\s*lang\s*>/giu, "")
    .replace(/<\s*\/?\s*(?:primary|locale)\b[^>]*>/giu, "")
    .trim()
}

export function containsPriceQuote(content: string): boolean {
  return /(?:¥|￥|\d[\d,]*(?:円|万円)|料金は\d|単価は\d|概算(?:で|は)?\d|相場(?:で|は)?\d)/u.test(content)
}
