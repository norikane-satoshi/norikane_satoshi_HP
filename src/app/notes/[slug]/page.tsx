import type { Metadata } from "next"
import {hasLocale} from "next-intl"
import {getLocale, getTranslations} from "next-intl/server"
import { notFound } from "next/navigation"
import {
  getNotePublicationStatusBySlug,
  getPublishedNoteBySlug,
  listPublishedNotes,
} from "@/lib/notion/server/fetch-note"
import { buildSlugIndex, RenderBlocks } from "@/lib/notion/server/render-blocks"
import {localeAlternates} from "@/i18n/metadata"
import {Link} from "@/i18n/navigation"
import {routing} from "@/i18n/routing"

export const revalidate = 3600

const SITE_URL = "https://norikane.studio"

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const notes = (await Promise.all([
    listPublishedNotes("ja"),
    listPublishedNotes("en"),
  ])).flat()
  return [...new Set(notes.map((note) => note.slug))].map((slug) => ({slug}))
}

type PageProps = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata(
  { params }: PageProps
): Promise<Metadata> {
  const { slug } = await params
  const requestedLocale = await getLocale()
  const locale = hasLocale(routing.locales, requestedLocale)
    ? requestedLocale
    : routing.defaultLocale
  const t = await getTranslations({locale, namespace: "Notes"})
  const metadata = await getTranslations({locale, namespace: "Metadata"})
  const note = await getPublishedNoteBySlug(slug, locale)
  if (note) {
    return {
      title: `${note.title} | ${metadata("brandName")}`,
      description: note.title,
      alternates: {
        ...localeAlternates(`/notes/${note.slug}`, locale),
      },
      openGraph: {
        title: note.title,
        type: "article",
        url: new URL(`/${locale}/notes/${note.slug}`, SITE_URL).toString(),
        locale: locale === "ja" ? "ja_JP" : "en_US",
      },
      twitter: { card: "summary_large_image" },
    }
  }

  const publicationStatus = await getNotePublicationStatusBySlug(slug, locale)
  if (publicationStatus === "unpublished") {
    return {
      title: `${t("unpublishedMetadata")} | ${metadata("brandName")}`,
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

  return { title: metadata("brandName") }
}

function UnpublishedNotePage({back, eyebrow, title, description}: {
  back: string
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 md:px-10 xl:px-14 space-y-6">
      <nav>
        <Link
          href="/#philosophy"
          className="inline-flex items-center gap-2 text-sm text-hp-muted transition-colors hover:text-hp"
        >
          <span aria-hidden="true">←</span>
          {back}
        </Link>
      </nav>
      <article className="glass-card p-8 md:p-10 xl:p-14">
        <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-hp md:text-4xl xl:text-5xl">
          {title}
        </h1>
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-hp-muted md:text-base">
          {description}
        </p>
      </article>
    </div>
  )
}

export default async function NotePage({ params }: PageProps) {
  const { slug } = await params
  const requestedLocale = await getLocale()
  const locale = hasLocale(routing.locales, requestedLocale)
    ? requestedLocale
    : routing.defaultLocale
  const t = await getTranslations({locale, namespace: "Notes"})
  const [note, allNotes] = await Promise.all([
    getPublishedNoteBySlug(slug, locale),
    listPublishedNotes(locale),
  ])

  if (!note) {
    const publicationStatus = await getNotePublicationStatusBySlug(slug, locale)
    if (publicationStatus === "unpublished") {
      return <UnpublishedNotePage
        back={t("back")}
        eyebrow={t("eyebrow")}
        title={t("unpublishedTitle")}
        description={t("unpublishedDescription")}
      />
    }
    notFound()
  }

  const slugIndex = buildSlugIndex(allNotes)
  const index = allNotes.findIndex((n) => n.slug === note.slug)
  const label = index >= 0
    ? t("numberedEyebrow", {number: String(index + 1).padStart(2, "0")})
    : t("eyebrow")

  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 md:px-10 xl:px-14 space-y-6">
      <nav>
        <Link
          href="/#philosophy"
          className="hp-nav-link inline-flex items-center gap-2 rounded-[12px] px-1 py-1 text-sm transition-colors hover:text-hp"
        >
          <span aria-hidden="true">←</span>
          {t("back")}
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
          <RenderBlocks blocks={note.blocks} slugIndex={slugIndex} hideDiagrams={locale === "en"} />
        </div>
      </article>
    </div>
  )
}
