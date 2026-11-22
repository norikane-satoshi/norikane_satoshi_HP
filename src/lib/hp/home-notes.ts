import type { NoteSummary } from "@/lib/notion/server/fetch-note"

export type HomeNoteCard = {
  key: string
  href: string
  title: string
  label: string
  thumbnailSrc: string | null
  external: boolean
  publishedAt?: string
}

export type NoteKind = "note" | "column"

type NoteSettings = {
  kind?: NoteKind
  thumbnailSrc?: string
  shareThumbnail?: boolean
  publishedAt?: string
}

export const NOTE_SETTINGS: Readonly<Record<string, NoteSettings>> = {
  correction: {
    thumbnailSrc: "/notes/thumbnails/correction.webp",
    publishedAt: "2026-04-23",
  },
  "ai-thoughts": {
    kind: "column",
    thumbnailSrc: "/notes/thumbnails/ai-thoughts-diagram.png",
    shareThumbnail: true,
    publishedAt: "2026-11-22",
  },
}

export function getNoteLabel(slug: string, notes: readonly NoteSummary[]): string {
  const kind = NOTE_SETTINGS[slug]?.kind ?? "note"
  const sameKind = notes
    .filter((note) => (NOTE_SETTINGS[note.slug]?.kind ?? "note") === kind)
    .sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.slug.localeCompare(b.slug))
  const index = sameKind.findIndex((note) => note.slug === slug)
  const prefix = kind === "column" ? "Column" : "Note"
  return index < 0 ? prefix : `${prefix} ${String(index + 1).padStart(2, "0")}`
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
  const ownNotes = notes.map((note) => ({
    sortDate: note.createdTime.slice(0, 10),
    card: {
      key: note.id,
      href: `/notes/${note.slug}`,
      title: note.title,
      label: getNoteLabel(note.slug, notes),
      thumbnailSrc: NOTE_SETTINGS[note.slug]?.thumbnailSrc ?? null,
      external: false,
      publishedAt: NOTE_SETTINGS[note.slug]?.publishedAt,
    },
  }))
  const externalNotes = EXTERNAL_NOTES.map((note) => ({
    sortDate: note.publishedAt ?? "",
    card: { ...note, external: true },
  }))

  return [...ownNotes, ...externalNotes]
    .sort((a, b) => b.sortDate.localeCompare(a.sortDate))
    .map(({ card }) => card)
}
