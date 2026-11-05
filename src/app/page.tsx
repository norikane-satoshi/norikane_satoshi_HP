import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
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

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="#FFFFFF" aria-hidden="true" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

/** YouTube の公式配色（赤地に白の再生記号）。 */
function YoutubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="#FF0000"
        d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"
      />
      <path fill="#FFFFFF" d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

/** Instagram の公式グラデーション（左下の黄から右上の紫へ）。 */
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="hp-instagram-gradient" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FEDA75" />
          <stop offset="0.25" stopColor="#FA7E1E" />
          <stop offset="0.5" stopColor="#D62976" />
          <stop offset="0.75" stopColor="#962FBF" />
          <stop offset="1" stopColor="#4F5BD5" />
        </linearGradient>
      </defs>
      <path
        fill="url(#hp-instagram-gradient)"
        d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"
      />
    </svg>
  )
}

const socialIcons = {
  X: XIcon,
  YouTube: YoutubeIcon,
  Instagram: InstagramIcon,
} as const

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
            <div className="flex flex-wrap items-center gap-3">
              {profile.socialLinks.map(({ label, href }) => {
                const Icon = socialIcons[label]
                return (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hp-icon-badge"
                    aria-label={label}
                    title={label}
                  >
                    <Icon className="h-5 w-5" />
                  </a>
                )
              })}
              <PressDialog />
            </div>
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
    <div>
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
