import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import {
  chatbotKnowledgeSources,
  type ChatbotKnowledgeSource,
  type ChatbotKnowledgeTopic,
} from "@/lib/chatbot/knowledge/on-demand-sources"
import type { ConversationState, JobContext } from "@/lib/chatbot/domain"

export type ChatbotKnowledgeContext = {
  selectedSourceIds: readonly string[]
  notionReferencePrompt: string
  localMirrorPrompt: string
}

type BuildChatbotKnowledgeContextInput = {
  latestUserMessage: string
  conversationState: ConversationState
  jobContext: JobContext
  mirrorRoot?: string
}

const defaultMirrorRoot = "/Users/norikene_satoshi/notion-mirror/chatbot-knowledge"
const maxSourceExcerptChars = 900
const maxLocalMirrorPromptChars = 2600

export function buildChatbotKnowledgeContext(
  input: BuildChatbotKnowledgeContextInput,
): ChatbotKnowledgeContext | undefined {
  const topics = classifyKnowledgeTopics(input)
  if (topics.length === 0) return undefined

  const sources = chatbotKnowledgeSources.filter((source) =>
    source.topics.some((topic) => topics.includes(topic)),
  )
  if (sources.length === 0) return undefined

  const notionReferencePrompt = buildNotionReferencePrompt(sources)
  const localMirrorPrompt = buildLocalMirrorPrompt({
    sources,
    latestUserMessage: input.latestUserMessage,
    mirrorRoot: input.mirrorRoot ?? process.env.CHATBOT_NOTION_MIRROR_ROOT ?? defaultMirrorRoot,
  })

  return {
    selectedSourceIds: sources.map((source) => source.id),
    notionReferencePrompt,
    localMirrorPrompt,
  }
}

function classifyKnowledgeTopics(input: BuildChatbotKnowledgeContextInput): ChatbotKnowledgeTopic[] {
  const text = input.latestUserMessage.normalize("NFKC").toLowerCase()
  const topics = new Set<ChatbotKnowledgeTopic>()

  if (
    input.conversationState.hasDesiredSchedule ||
    input.jobContext.jobKind ||
    matchesAny(text, schedulePatterns)
  ) {
    topics.add("schedule")
    topics.add("workflow")
  }
  if (matchesAny(text, colorCorrectionPatterns)) {
    topics.add("color-correction")
    topics.add("color-grading")
  }
  if (matchesAny(text, colorGradingPatterns)) topics.add("color-grading")
  if (matchesAny(text, filmLookPatterns)) topics.add("film-look")

  return [...topics]
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

const schedulePatterns = [
  /工程/u,
  /日数/u,
  /納品/u,
  /納期/u,
  /搬入/u,
  /受け取り/u,
  /作業(?:期間|目安|日|時間)?/u,
  /スケジュール/u,
  /予約/u,
  /候補/u,
  /空き/u,
  /ライブ/u,
  /cm/u,
  /mv/u,
  /ドラマ/u,
  /本編/u,
  /縦型/u,
] as const

const colorCorrectionPatterns = [
  /カラコレ/u,
  /カラーコレクション/u,
  /色(?:合わせ|味|補正)/u,
  /露出/u,
  /カメラ(?:差|マッチ)/u,
] as const

const colorGradingPatterns = [
  /カラーグレーディング/u,
  /グレーディング/u,
  /ルック/u,
  /トーン/u,
] as const

const filmLookPatterns = [
  /フィルム/u,
  /film\s*look/u,
  /グレイン/u,
  /プリンタ/u,
  /濃度/u,
] as const

function buildNotionReferencePrompt(sources: readonly ChatbotKnowledgeSource[]): string {
  return [
    "オンデマンド知識参照（TIA1/TIA2 Notion AI）:",
    "本文を丸ごと再送せず、アクセス許可済みの Notion page / public note を必要時だけ参照する。",
    ...sources.map(
      (source) =>
        `- ${source.title}: ${source.summary} / source=${source.sourceUrl}`,
    ),
  ].join("\n")
}

function buildLocalMirrorPrompt(input: {
  sources: readonly ChatbotKnowledgeSource[]
  latestUserMessage: string
  mirrorRoot: string
}): string {
  const blocks = input.sources.map((source) => {
    const mirrorBody = readMirrorBody(input.mirrorRoot, source.mirrorPath)
    const body = mirrorBody || source.body
    const detail = body ? extractRelevantExcerpt(body, input.latestUserMessage) : source.summary

    return `- ${source.title} (${source.mirrorPath})\n${detail}`
  })
  const prompt = [
    "オンデマンド知識詳細（TIA3 local mirror）:",
    "Notion に直接アクセスできないため、local mirror の該当 excerpt だけを使う。",
    ...blocks,
  ].join("\n")

  return truncate(prompt, maxLocalMirrorPromptChars)
}

function readMirrorBody(root: string, relativePath: string): string | undefined {
  const resolvedRoot = path.resolve(root)
  const fullPath = path.resolve(resolvedRoot, relativePath)
  if (fullPath !== resolvedRoot && !fullPath.startsWith(`${resolvedRoot}${path.sep}`)) return undefined
  if (!existsSync(fullPath)) return undefined

  try {
    return readFileSync(fullPath, "utf8")
  } catch {
    return undefined
  }
}

function extractRelevantExcerpt(body: string, query: string): string {
  const compactBody = body.replace(/\n{3,}/g, "\n\n").trim()
  const keyword = extractQueryKeywords(query).find((candidate) => compactBody.includes(candidate))
  if (!keyword) return truncate(compactBody, maxSourceExcerptChars)

  const index = compactBody.indexOf(keyword)
  const start = Math.max(0, index - Math.floor(maxSourceExcerptChars / 3))
  const end = Math.min(compactBody.length, start + maxSourceExcerptChars)
  return truncate(compactBody.slice(start, end).trim(), maxSourceExcerptChars)
}

function extractQueryKeywords(query: string): string[] {
  return query
    .normalize("NFKC")
    .split(/[^\p{Letter}\p{Number}]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars).trimEnd()}...`
}
