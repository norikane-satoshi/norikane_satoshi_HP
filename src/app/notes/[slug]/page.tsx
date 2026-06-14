import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  getPublishedNoteBySlug,
  listPublishedNotes,
} from "@/lib/notion/server/fetch-note"
import { buildSlugIndex, RenderBlocks } from "@/lib/notion/server/render-blocks"
import { SITE_BRAND_NAME } from "@/lib/site-brand"

export const revalidate = 3600

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const notes = await listPublishedNotes()
  return notes.map((n) => ({ slug: n.slug }))
}

type PageProps = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata(
  { params }: PageProps
): Promise<Metadata> {
  const { slug } = await params
  const note = await getPublishedNoteBySlug(slug)
  if (!note) {
    return { title: SITE_BRAND_NAME }
  }
  return {
    title: `${note.title} | ${SITE_BRAND_NAME}`,
    description: note.title,
    openGraph: { title: note.title, type: "article" },
    twitter: { card: "summary_large_image" },
  }
}

export default async function NotePage({ params }: PageProps) {
  const { slug } = await params
  const [note, allNotes] = await Promise.all([
    getPublishedNoteBySlug(slug),
    listPublishedNotes(),
  ])
  if (!note) notFound()

  const slugIndex = buildSlugIndex(allNotes)
  const index = allNotes.findIndex((n) => n.slug === note.slug)
  const label =
    index >= 0 ? `Note ${String(index + 1).padStart(2, "0")}` : "Note"

  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 md:px-10 xl:px-14 space-y-6">
      <nav>
        <Link
          href="/#philosophy"
          className="hp-nav-link inline-flex items-center gap-2 rounded-[12px] px-1 py-1 text-sm transition-colors hover:text-hp"
        >
          <span aria-hidden="true">←</span>
          ノート一覧に戻る
        </Link>
      </nav>
      <article className="glass-card glass-card--hp-note-page p-8 md:p-10 xl:p-14">
        <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">
          {label}
        </p>
        <h1 className="hp-heading mt-2 text-3xl font-bold text-hp md:text-4xl xl:text-5xl">
          {note.title}
        </h1>
        <div className="mt-8">
          <RenderBlocks blocks={note.blocks} slugIndex={slugIndex} />
        </div>
      </article>
    </div>
  )
}
