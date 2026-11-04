import type { NoteSummary } from "@/lib/notion/server/fetch-note"

export type HomeNoteCard = {
  key: string
  href: string
  title: string
  label: string
  thumbnailSrc: string | null
  external: boolean
  publishedAt: string
}

/** Notion のノート（slug）ごとのサムネイル。 */
export const NOTE_THUMBNAILS: Readonly<Record<string, string>> = {
  correction: "/notes/thumbnails/correction.webp",
}

/** サイト外に掲載した記事。ノート欄に Notion のノートと並べて出す。 */
export const EXTERNAL_NOTES: readonly Omit<HomeNoteCard, "external">[] = [
  {
    key: "pronews-davinci-resolve-21-color",
    href: "https://jp.pronews.com/review/202608150955772789.html",
    title:
      "現役カラリストが見るDaVinci Resolve 21 カラーページ：主役は“ワークフロー改善”。「これは実務で使える」と感じた新機能たち",
    label: "PRONEWS",
    thumbnailSrc: "/notes/thumbnails/pronews-davinci-resolve-21-color.webp",
    publishedAt: "2026-08-15",
  },
]

/** Notion のノートと外部記事を、新しい順に並べたカード一覧にする。 */
export function buildHomeNoteCards(notes: readonly NoteSummary[]): HomeNoteCard[] {
  const ownNotes = [...notes]
    // listPublishedNotes は作成日の古い順で返す。番号は新しいノートを 01 にする（従来どおり）。
    .reverse()
    .map((note, index) => ({
      key: note.id,
      href: `/notes/${note.slug}`,
      title: note.title,
      label: `Note ${String(index + 1).padStart(2, "0")}`,
      thumbnailSrc: NOTE_THUMBNAILS[note.slug] ?? null,
      external: false,
      publishedAt: note.createdTime.slice(0, 10),
    }))
  const externalNotes = EXTERNAL_NOTES.map((note) => ({ ...note, external: true }))

  return [...ownNotes, ...externalNotes].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  )
}
