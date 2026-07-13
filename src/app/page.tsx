import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, MessageCircle } from "lucide-react"
import { FeaturedWorks } from "@/components/hp/featured-works"
import { HeroSection } from "@/components/hp/hero-section"
import { PressDialog } from "@/components/hp/press-section"
import { ProfilePhoto } from "@/components/hp/profile-photo"
import { SITE_TAGLINE, SITE_TITLE } from "@/lib/site-brand"
import {
  DAVINCI_RESOLVE_TRAINER_TEXT,
  DAVINCI_RESOLVE_TRAINING_URL,
} from "@/lib/hp/davinci-trainer"
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
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function YoutubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  )
}

const socialIcons = {
  X: XIcon,
  YouTube: YoutubeIcon,
  Instagram: InstagramIcon,
} as const

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
        className="inline text-inherit underline decoration-current decoration-1 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
      >
        {DAVINCI_RESOLVE_TRAINER_TEXT}
      </a>
      {after}
    </>
  )
}

function ProfileForeground() {
  return (
    <div className="hp-grid hp-profile-grid min-w-0">
      {/* Left: profile photo + social links */}
      <div className="hp-profile-sidebar flex min-w-0 max-w-full flex-col items-center gap-5 @[680px]/profile:items-start">
        <ProfilePhoto />
        <div className="mt-1 flex items-center justify-center gap-3 @[680px]/profile:justify-start">
          {hpPublicContent.profile.socialLinks.map(({ label, href }) => {
            const Icon = socialIcons[label]
            return (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-btn glass-btn--profile-social flex h-10 w-10 items-center justify-center text-hp"
                aria-label={label}
              >
                <Icon className="h-4 w-4" />
              </a>
            )
          })}
          <PressDialog />
        </div>
      </div>

      {/* Right: career timeline */}
      <div className="hp-profile-main">
        <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">
          Career
        </p>
        <div className="hp-career-list">
          {hpPublicContent.profile.timeline.map((item) => (
            <div
              key={item.year}
              className="hp-career-item"
            >
              <span
                className="hp-career-year font-[var(--font-inter)] text-sm font-bold"
                style={{ color: "var(--accent-primary)" }}
              >
                {item.year}
              </span>
              <div className="hp-career-body">
                <p className="hp-compact-text text-sm font-semibold text-hp md:text-base">
                  {item.event}
                </p>
                <p className="hp-body mt-2 text-xs text-hp-muted md:text-sm">
                  {item.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default async function HomePage() {
  const notes = await listPublishedNotes()
  return (
    <div className="hp-section-stack">
      <HeroSection />

      {/* Intro */}
      <section className="hp-section-shell hp-grid">
        <p className="hp-body hp-intro-measure text-base text-hp md:text-lg">
          {renderIntroTextWithTrainerLink()}
        </p>
      </section>

      {/* Philosophy — horizontal scroll notes */}
      <section
        id="philosophy"
        className="hp-section-shell scroll-mt-24 md:scroll-mt-28"
      >
        <div className="hp-grid">
          <div className="hp-section-heading hp-section-title-stack">
            <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">Notes</p>
            <h2 className="hp-heading text-2xl font-semibold text-hp md:text-3xl">
              ノート
            </h2>
          </div>
        </div>

        <div className="mt-[var(--hp-space-4)] mx-[calc(var(--hp-section-padding-x)*-1)] overflow-x-auto">
          <div className="flex snap-x snap-mandatory gap-4 px-[var(--hp-section-padding-x)] pb-4 md:gap-5">
            {notes.map((note, idx) => (
              <Link
                key={note.id}
                href={`/notes/${note.slug}`}
                className="group flex shrink-0 snap-start flex-col glass-card-sm glass-card-sm--hp-note p-6 md:p-7"
                style={{ width: "min(84vw, 340px)", minHeight: 200 }}
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-[var(--font-inter)] text-[11px] font-semibold uppercase tracking-[0.18em] text-hp-muted">
                    {`Note ${String(idx + 1).padStart(2, "0")}`}
                  </span>
                </div>
                <h3 className="hp-heading mt-3 text-base md:text-lg font-semibold text-hp">
                  {note.title}
                </h3>
                <div className="mt-auto pt-6 flex justify-end">
                  <ArrowRight
                    className="h-5 w-5 transition-transform group-hover:translate-x-1"
                    style={{ color: "var(--accent-primary)" }}
                  />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Profile */}
      <section
        id="profile"
        className="hp-section-shell scroll-mt-24 md:scroll-mt-28"
      >
        <div className="@container/profile">
          <div className="hp-section-title-stack">
            <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">Profile</p>
            <h2 className="hp-heading text-2xl font-semibold text-hp md:text-3xl">
              {hpPublicContent.profile.sectionTitle}
            </h2>
          </div>

          <div className="glass-card glass-card--hp-profile mt-[var(--hp-space-3)] p-8 md:p-10 xl:p-12">
            <div className="min-w-0 text-center @[680px]/profile:text-left">
              <p className="text-sm text-hp-muted">{hpPublicContent.profile.name}</p>
              <p className="hp-compact-text mt-1 text-base font-semibold text-hp md:text-lg">
                {hpPublicContent.profile.title}
              </p>
              <div className="mt-[var(--hp-space-2)] flex flex-wrap justify-center gap-2 @[680px]/profile:justify-start">
                {hpPublicContent.profile.tools.map((tool) => (
                  <span
                    key={tool}
                    className="glass-badge glass-badge--profile-tool px-3 py-1 text-xs font-medium"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
            <ProfileForeground />
          </div>
        </div>
      </section>

      <section className="hp-section-shell">
        <FeaturedWorks />
      </section>

      <section className="hp-section-shell">
        <div className="glass-card-sm flex min-w-0 flex-col items-start justify-between gap-4 overflow-hidden p-6 md:flex-row md:items-center md:p-7">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">LINE</p>
            <h2 className="mt-2 text-lg font-semibold text-hp md:text-xl">公式LINEから予約する</h2>
          </div>
          <a
            className="glass-btn inline-flex min-h-11 max-w-full items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-hp"
            href="https://line.me/R/ti/p/%40044ucnym"
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle aria-hidden="true" size={18} />
            <span className="min-w-0 break-words">公式LINEを友だち追加</span>
          </a>
        </div>
      </section>
    </div>
  )
}
