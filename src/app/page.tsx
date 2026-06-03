import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { ContactChatbotButton } from "@/components/hp/contact-chatbot-button"
import { FeaturedWorks } from "@/components/hp/featured-works"
import { HeroSection } from "@/components/hp/hero-section"
import { HomeScheduleSection } from "@/components/hp/home-schedule-section"
import { ProfilePhoto } from "@/components/hp/profile-photo"
import { isBookingEnabled } from "@/lib/feature-flags"
import { SITE_TAGLINE, SITE_TITLE } from "@/lib/site-brand"
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

const timeline = [
  {
    year: "2013",
    event: "IMAGICA 入社",
    detail:
      "静岡文化芸術大学デザイン学部卒業後、IMAGICA にてカラリストアシスタントとしてキャリアをスタート。フィルムテレシネ業務を経て、DaVinci Resolve によるグレーディング技術を習得。",
  },
  {
    year: "2018",
    event: "メインカラリスト",
    detail:
      "劇場映画・配信作品・CM・MVのカラーグレーディングを担当。DaVinci Resolve によるオンラインエディット・VFX 連携のサービスを立ち上げ、部署全体に新ワークフローを展開。ACES ワークフローによるカラーマネジメントを専門に。DaVinci Resolve 認定トレーナーとして、テレビ局や Blackmagic Design 本社での講義活動も行う。",
  },
  {
    year: "2023",
    event: "バーチャルプロダクション カラークリエイター兼任",
    detail:
      "LED ウォールを用いた撮影現場でのオンセットカラーマネジメントを担当。異なるソース間のカラーを統一し、CG 素材・LED 背景と実写素材の自然な馴染ませを実現。",
  },
  {
    year: "2026",
    event: "独立開業",
    detail:
      "のりかね映像設計室（Norikane Film Design Office）として独立。カラーグレーディングの体系化と教育にも取り組む。",
  },
]

const tools = [
  "DaVinci Resolve",
  "Premiere Pro",
  "After Effects",
  "Photoshop",
]

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

const socialLinks = [
  { label: "X", href: "https://x.com/norikanesatoshi", Icon: XIcon },
  {
    label: "YouTube",
    href: "https://www.youtube.com/@norikanesatoshi",
    Icon: YoutubeIcon,
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/satoshi_norikane_colorist/",
    Icon: InstagramIcon,
  },
]

export default async function HomePage() {
  const notes = await listPublishedNotes()
  return (
    <div className="space-y-12 md:space-y-16">
      <HeroSection />

      {/* Intro */}
      <section className="mx-auto w-full max-w-[1440px] px-6 md:px-10 xl:px-14">
        <div className="hp-section-rule grid grid-cols-1 gap-7 md:grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] md:gap-12">
          <p className="hp-compact-text text-sm font-semibold text-hp-muted">Colorist / Trainer</p>
          <div className="max-w-4xl">
            <p className="hp-editorial-lead font-semibold text-hp">
              映像の質感を、作品の意図に合わせて設計します。
            </p>
            <p className="hp-body mt-5 text-base text-hp-muted md:text-lg">
              フリーランスカラリストとして、劇場映画・配信作品・CM・ブランドフィルムのカラーグレーディングを承っています。立ち会い対応・リモート対応どちらも可能です。プロジェクトの規模・スケジュール・納品仕様に合わせた柔軟なワークフローでご提案いたします。DaVinci Resolve 認定トレーナーとして講義、講習会のご依頼も承ってます。
            </p>
          </div>
        </div>
      </section>

      {/* Philosophy — horizontal scroll notes */}
      <section
        id="philosophy"
        className="mx-auto w-full max-w-[1440px] px-6 md:px-10 xl:px-14 scroll-mt-24 md:scroll-mt-28"
      >
        <div className="hp-section-rule max-w-3xl">
          <h2 className="hp-heading text-2xl md:text-3xl font-semibold text-hp">
            ノート
          </h2>
          <p className="hp-body mt-3 text-sm text-hp-muted md:text-base">
            ルック設計、補正、グレーディングの考え方を制作現場の言葉で整理します。
          </p>
        </div>

        <div className="mt-8 -mx-6 md:-mx-10 xl:-mx-14 overflow-x-auto">
          <div className="flex snap-x snap-mandatory gap-4 px-6 pb-4 md:gap-5 md:px-10 xl:px-14">
            {notes.map((note, idx) => (
              <Link
                key={note.id}
                href={`/notes/${note.slug}`}
                className="group flex shrink-0 snap-start flex-col glass-card-sm p-6 md:p-7"
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
        className="mx-auto w-full max-w-[1440px] px-6 md:px-10 xl:px-14 scroll-mt-24 md:scroll-mt-28"
      >
        <div className="glass-card glass-card--showcase p-8 md:p-10 xl:p-12">
          <div className="max-w-3xl">
            <h2 className="hp-heading text-2xl font-semibold text-hp md:text-3xl">
              プロフィール
            </h2>
            <p className="hp-body mt-3 text-sm text-hp-muted md:text-base">
              ポストプロダクション、オンセット、教育の現場を横断して、色の判断を言語化できるカラリストとして活動しています。
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-10 md:grid-cols-[minmax(220px,240px)_minmax(0,1fr)] md:gap-12 xl:gap-16">
            {/* Left: photo + identity + tools */}
            <div className="flex flex-col items-center gap-5 md:items-start">
              <ProfilePhoto />
              <div className="text-center md:text-left">
                <p className="text-sm text-hp-muted">則兼 智志</p>
                <p className="hp-compact-text mt-1 text-base font-semibold text-hp md:text-lg">
                  フリーランスカラリスト
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 md:justify-start">
                {tools.map((tool) => (
                  <span
                    key={tool}
                    className="glass-badge px-3 py-1 text-xs font-medium"
                  >
                    {tool}
                  </span>
                ))}
              </div>

              <div className="mt-1 flex items-center justify-center gap-3 md:justify-start">
                {socialLinks.map(({ label, href, Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="glass-btn flex h-10 w-10 items-center justify-center text-hp"
                    aria-label={label}
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                ))}
              </div>
            </div>

            {/* Right: career timeline */}
            <div>
              <p className="hp-compact-text text-sm font-semibold text-hp-muted">Career</p>
              <div className="mt-5 space-y-6 md:space-y-7">
                {timeline.map((item) => (
                  <div
                    key={item.year}
                    className="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-3 md:gap-4"
                  >
                    <span
                      className="font-[var(--font-inter)] text-sm font-bold"
                      style={{ color: "var(--accent-primary)" }}
                    >
                      {item.year}
                    </span>
                    <div>
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

          <FeaturedWorks />
        </div>
      </section>

      <section
        id="contact"
        className="mx-auto w-full max-w-[1440px] px-6 md:px-10 xl:px-14 scroll-mt-24 md:scroll-mt-28"
      >
        <div className="glass-card grid gap-8 p-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:p-10 xl:p-12">
          <div className="max-w-3xl">
            <p className="hp-compact-text text-sm font-semibold text-hp-muted">Contact</p>
            <h2 className="hp-heading mt-3 text-2xl font-semibold text-hp md:text-3xl">
              AI 相談窓口
            </h2>
            <p className="hp-body mt-4 text-sm text-hp-muted md:text-base">
              作品の方向性、納期、素材状況を整理してから相談を始められます。必要な場合は、そのまま予約導線へ進めます。
            </p>
          </div>
          <ContactChatbotButton />
        </div>
      </section>

      {isBookingEnabled() ? <HomeScheduleSection /> : null}
    </div>
  )
}
