import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  getNotePublicationStatusBySlug,
  getPublishedNoteBySlug,
  listPublishedNotes,
} from "@/lib/notion/server/fetch-note"
import { buildSlugIndex, RenderBlocks } from "@/lib/notion/server/render-blocks"
import { SITE_BRAND_NAME } from "@/lib/site-brand"

export const revalidate = 3600

const SITE_URL = "https://norikane.studio"

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
  if (note) {
    return {
      title: `${note.title} | ${SITE_BRAND_NAME}`,
      description: note.title,
      alternates: {
        canonical: new URL(`/notes/${note.slug}`, SITE_URL).toString(),
      },
      openGraph: { title: note.title, type: "article" },
      twitter: { card: "summary_large_image" },
    }
  }

  const publicationStatus = await getNotePublicationStatusBySlug(slug)
  if (publicationStatus === "unpublished") {
    return {
      title: `公開停止中のノート | ${SITE_BRAND_NAME}`,
      robots: {
        index: false,
        follow: false,
        googleBot: {
          index: false,
          follow: false,
        },
      },
    }
  }

  return { title: SITE_BRAND_NAME }
}

function UnpublishedNotePage() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 md:px-10 xl:px-14 space-y-6">
      <nav>
        <Link
          href="/#philosophy"
          className="inline-flex items-center gap-2 text-sm text-hp-muted transition-colors hover:text-hp"
        >
          <span aria-hidden="true">←</span>
          公開中のノート一覧に戻る
        </Link>
      </nav>
      <article className="glass-card p-8 md:p-10 xl:p-14">
        <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">
          Note
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-hp md:text-4xl xl:text-5xl">
          このノートは現在公開していません
        </h1>
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-hp-muted md:text-base">
          公開状態が切り替わったため、このURLのノート本文は表示していません。
          現在公開中のノートは一覧から確認できます。
        </p>
      </article>
    </div>
  )
}

export default async function NotePage({ params }: PageProps) {
  const { slug } = await params
  const [note, allNotes] = await Promise.all([
    getPublishedNoteBySlug(slug),
    listPublishedNotes(),
  ])

  if (!note) {
    const publicationStatus = await getNotePublicationStatusBySlug(slug)
    if (publicationStatus === "unpublished") return <UnpublishedNotePage />
    notFound()
  }

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
        <h1 className="hp-heading hp-note-title mt-2 text-3xl font-bold text-hp md:text-4xl xl:text-5xl">
          {note.title}
        </h1>
        <div className="mt-8">
          <RenderBlocks blocks={note.blocks} slugIndex={slugIndex} />
        </div>
      </article>
    </div>
  )
}
