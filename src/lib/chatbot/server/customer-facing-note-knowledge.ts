import type { ChatbotKnowledgeSnapshot } from "@/lib/chatbot/server/notion-knowledge-sync"

type NoteKnowledgeEntry = ChatbotKnowledgeSnapshot["noteKnowledge"][number]

export function selectCustomerFacingNoteKnowledge(snapshot: ChatbotKnowledgeSnapshot, context: string) {
  return snapshot.noteKnowledge.filter(
    (entry) =>
      entry.includedInPrompt === true &&
      entry.content.trim().length > 0 &&
      noteKnowledgeEntryMatches(context, entry),
  )
}

export function noteKnowledgeEntryMatches(context: string, entry: NoteKnowledgeEntry): boolean {
  return noteKnowledgeEntryKeywords(entry).some((keyword) => keyword && context.includes(keyword))
}

function noteKnowledgeEntryKeywords(entry: NoteKnowledgeEntry): string[] {
  const usageKeywords: Record<NoteKnowledgeEntry["usage"], string[]> = {
    "color-correction": ["カラーコレクション", "カラコレ", "correction"],
    "color-grading": ["カラーグレーディング", "グレーディング", "grading"],
    "film-look": ["フィルムルック", "フィルム", "ルック", "filmlook"],
    "site-rule": [],
  }
  return [...usageKeywords[entry.usage], ...(entry.slug ? [entry.slug] : [])]
}
