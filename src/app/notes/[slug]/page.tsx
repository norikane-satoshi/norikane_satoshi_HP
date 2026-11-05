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
    <div className="hp-noir-page" data-hp-theme="noir">
      <div className="mx-auto w-full max-w-[1440px] px-6 pb-[clamp(5rem,10vw,8rem)] md:px-10 xl:px-14">
        <NotesBackLink label="公開中のノート一覧に戻る" />
        <article className="hp-note-article">
          <header className="hp-note-header">
            <p className="hp-eyebrow">Note</p>
            <h1 className="hp-note-title mt-4 text-hp">このノートは現在公開していません</h1>
          </header>
          <p className="mx-auto mt-8 max-w-[46rem] text-sm leading-relaxed text-hp-muted md:text-base">
            公開状態が切り替わったため、このURLのノート本文は表示していません。
            現在公開中のノートは一覧から確認できます。
          </p>
        </article>
      </div>
    </div>
  )
}

function NotesBackLink({ label }: { label: string }) {
  return (
    <nav className="pt-[clamp(2rem,5vw,3.5rem)]">
      <Link
        href="/#philosophy"
        className="hp-plain-link inline-flex items-center gap-2 text-sm text-hp-muted"
      >
        <span aria-hidden="true">←</span>
        {label}
      </Link>
    </nav>
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
    <div className="hp-noir-page" data-hp-theme="noir">
      <div className="mx-auto w-full max-w-[1440px] px-6 pb-[clamp(5rem,10vw,8rem)] md:px-10 xl:px-14">
        <NotesBackLink label="ノート一覧に戻る" />
        <article className="hp-note-article">
          <header className="hp-note-header">
            <p className="hp-eyebrow">{label}</p>
            <h1 className="hp-heading hp-note-title mt-4 text-hp">{note.title}</h1>
          </header>
          <div className="hp-note-body">
            <RenderBlocks blocks={note.blocks} slugIndex={slugIndex} />
          </div>
        </article>
      </div>
    </div>
  )
}
