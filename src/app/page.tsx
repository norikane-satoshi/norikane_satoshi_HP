import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight, ArrowUpRight } from "lucide-react"
import { FeaturedWorks } from "@/components/hp/featured-works"
import { HeroSection } from "@/components/hp/hero-section"
import { PressDialog } from "@/components/hp/press-section"
import { ProfilePhoto } from "@/components/hp/profile-photo"
import { SectionHeading } from "@/components/hp/section-heading"
import { SITE_TAGLINE, SITE_TITLE } from "@/lib/site-brand"
import {
  DAVINCI_RESOLVE_TRAINER_TEXT,
  DAVINCI_RESOLVE_TRAINING_URL,
} from "@/lib/hp/davinci-trainer"
import { buildHomeNoteCards } from "@/lib/hp/home-notes"
import { hpPublicContent } from "@/lib/hp/public-content"
import { listPublishedNotes } from "@/lib/notion/server/fetch-note"

export const revalidate = 3600

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_TAGLINE,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_TAGLINE,
    type: "website",
  },
  twitter: { card: "summary_large_image" },
}

async function listPublishedNotesForHome() {
  try {
    return await listPublishedNotes()
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined
    console.error("[HP_HOME_NOTES_FETCH_FAILED]", {
      event: "hp_home_notes_fetch_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
      causeName: cause?.name,
      causeCode: cause && "code" in cause ? String(cause.code) : undefined,
    })
    return []
  }
}

function renderIntroTextWithTrainerLink() {
  const [before, after] = hpPublicContent.intro.split(DAVINCI_RESOLVE_TRAINER_TEXT)

  if (after === undefined) {
    return hpPublicContent.intro
  }

  return (
    <>
      {before}
      <a
        href={DAVINCI_RESOLVE_TRAINING_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="hp-text-link"
      >
        {DAVINCI_RESOLVE_TRAINER_TEXT}
      </a>
      {after}
    </>
  )
}

function ProfileSection() {
  const { profile } = hpPublicContent
  return (
    <section id="profile" className="hp-surface-band scroll-mt-24 md:scroll-mt-28">
      <div className="hp-section-shell hp-section-pad">
        <SectionHeading latin="Profile" />
        <div className="mt-[clamp(2.5rem,5vw,4.5rem)] flex flex-wrap gap-x-[clamp(2.5rem,6vw,6rem)] gap-y-12">
          <div className="flex min-w-0 max-w-[32.5rem] flex-[1_1_18.75rem] flex-col gap-7">
            <ProfilePhoto />
            <div className="flex flex-col gap-2">
              <p className="text-[clamp(1.875rem,2.8vw,2.5rem)] font-medium tracking-[0.1em] text-hp">
                {profile.name}
              </p>
              <p className="hp-body text-[0.9375rem] tracking-[0.06em] text-hp-muted">
                {profile.title}
              </p>
            </div>
            <p className="font-[var(--font-inter)] text-xs leading-loose tracking-[0.12em] text-hp-muted">
              {profile.tools.join(" · ")}
            </p>
            <ul className="flex flex-wrap gap-x-7 font-[var(--font-inter)] text-[0.8125rem] tracking-[0.1em]">
              {profile.socialLinks.map(({ label, href }) => (
                <li key={label}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hp-plain-link inline-flex min-h-11 items-center gap-1.5"
                  >
                    {label}
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </li>
              ))}
              <li>
                <PressDialog />
              </li>
            </ul>
          </div>

          <div className="min-w-0 flex-[2_1_32.5rem]">
            <p className="hp-eyebrow mb-3">Career</p>
            <ol>
              {profile.timeline.map((item) => (
                <li key={item.year} className="hp-rule-top grid grid-cols-[minmax(5.25rem,8.75rem)_minmax(0,1fr)] gap-x-6 gap-y-3 py-8">
                  <span className="hp-latin-numeral">{item.year}</span>
                  <div className="flex flex-col gap-3">
                    <h3 className="break-normal text-[clamp(1.125rem,1.5vw,1.375rem)] font-medium leading-relaxed tracking-[0.06em] text-hp">
                      {item.event}
                    </h3>
                    <p className="hp-body text-[0.9375rem] leading-[2.05] tracking-[0.04em] text-hp-muted">
                      {item.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  )
}

export default async function HomePage() {
  const noteCards = buildHomeNoteCards(await listPublishedNotesForHome())
  return (
    <div className="hp-noir-page" data-hp-theme="noir">
      <HeroSection />

      <section className="hp-section-shell hp-section-pad">
        <p className="hp-intro-text">{renderIntroTextWithTrainerLink()}</p>
      </section>

      <section id="works" className="scroll-mt-24 pb-[clamp(6rem,10vw,10rem)] md:scroll-mt-28">
        <FeaturedWorks />
      </section>

      <section
        id="philosophy"
        className="hp-section-shell scroll-mt-24 pb-[clamp(6rem,10vw,10rem)] md:scroll-mt-28"
      >
        <SectionHeading latin="Notes" />
        <div className="mt-[clamp(2.25rem,4vw,3.5rem)] grid grid-cols-1 md:grid-cols-2 gap-x-[clamp(1.5rem,3vw,3rem)] gap-y-[clamp(2.25rem,4vw,3.5rem)]">
          {noteCards.map((note) => {
            const cardBody = (
              <>
                <div className="relative aspect-video overflow-hidden bg-[var(--hp-color-surface-raised)]">
                  {note.thumbnailSrc ? (
                    <Image
                      src={note.thumbnailSrc}
                      alt=""
                      fill
                      sizes="(max-width: 768px) 92vw, 640px"
                      className="hp-media-zoom object-cover"
                      data-hp-note-thumbnail={note.key}
                    />
                  ) : null}
                </div>
                <span className="hp-eyebrow">{note.label}</span>
                <h3 className="break-normal text-[clamp(1.1875rem,1.6vw,1.5rem)] font-medium leading-[1.75] tracking-[0.04em] text-hp">
                  {note.title}
                </h3>
                <ArrowRight className="hp-arrow-nudge h-5 w-5 text-hp" strokeWidth={1.25} aria-hidden="true" />
              </>
            )
            return note.external ? (
              <a
                key={note.key}
                href={note.href}
                className="hp-note-card group"
                data-hp-note-card="external"
              >
                {cardBody}
              </a>
            ) : (
              <Link key={note.key} href={note.href} className="hp-note-card group" data-hp-note-card="note">
                {cardBody}
              </Link>
            )
          })}
        </div>
      </section>

      <ProfileSection />

    </div>
  )
}
