import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { HeroSection } from "@/components/hp/hero-section"
import { ContactForm } from "@/components/hp/contact-form"
import { HomeScheduleSection } from "@/components/hp/home-schedule-section"
import { ProfilePhoto } from "@/components/hp/profile-photo"
import { SITE_TAGLINE, SITE_TITLE } from "@/lib/site-brand"
import { listPublishedNotes } from "@/lib/notion/fetch-note"

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
      "LED ウォールを用いた撮影現場でのオンセットカラーマネジメントを担当。ACES ワークフローで異なるソース間のカラースペースを統一し、CG 素材・LED 背景と実写素材の自然な馴染ませを実現。",
  },
  {
    year: "2026",
    event: "独立開業",
    detail:
      "のりかね映像設計室（Norikane Film Design Office）として独立。カラーグレーディングの体系化と教育にも取り組む。",
  },
]

const featuredWorks = [
  { title: "火星の女王", client: "NHK100周年記念ドラマ" },
  { title: "十角館の殺人 / 時計館の殺人", client: "hulu" },
  {
    title: "福山雅治ライブフィルム「言霊の幸わう夏」「月光」",
    client: "松竹配給",
  },
  { title: "ゲキ×シネシリーズ", client: "ヴィレッヂ" },
  { title: "ライブ映像作品多数", client: "配信" },
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
    <div className="space-y-10 md:space-y-14">
      <HeroSection />

      {/* Intro */}
      <section className="mx-auto w-full max-w-[1440px] px-6 md:px-10 xl:px-14">
        <p className="text-base leading-relaxed text-hp md:text-lg">
          劇場映画・配信作品・CM・ブランドフィルムのカラーグレーディングを承っています。DaVinci Resolve 認定トレーナー / フリーランスカラリストとして、現場対応・リモート対応どちらも可能です。DaVinci Resolve を中心に、プロジェクトの規模・スケジュール・納品仕様に合わせた柔軟なワークフローで承ります。
        </p>
      </section>

      {/* Philosophy — horizontal scroll notes */}
      <section
        id="philosophy"
        className="mx-auto w-full max-w-[1440px] px-6 md:px-10 xl:px-14 scroll-mt-24 md:scroll-mt-28"
      >
        <p className="text-xs uppercase tracking-[0.28em] text-hp-muted">Notes</p>
        <h2 className="mt-2 text-2xl md:text-3xl font-semibold text-hp">
          ノート
        </h2>

        <div className="mt-8 -mx-6 md:-mx-10 xl:-mx-14 overflow-x-auto">
          <div className="flex snap-x snap-mandatory gap-4 px-6 pb-4 md:gap-5 md:px-10 xl:px-14">
            {notes.map((note, idx) => (
              <Link
                key={note.id}
                href={`/notes/${note.slug}`}
                className="group flex shrink-0 snap-start flex-col glass-card p-6 md:p-7"
                style={{ width: "min(84vw, 340px)", minHeight: 200 }}
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-[var(--font-inter)] text-[11px] font-semibold uppercase tracking-[0.18em] text-hp-muted">
                    {`Note ${String(idx + 1).padStart(2, "0")}`}
                  </span>
                </div>
                <h3 className="mt-3 text-base md:text-lg font-semibold text-hp leading-snug">
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
        <div className="glass-card p-8 md:p-10 xl:p-12">
          <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">Profile</p>
          <h2 className="mt-2 text-2xl font-semibold text-hp md:text-3xl">
            プロフィール
          </h2>

          <div className="mt-8 grid grid-cols-1 gap-10 md:grid-cols-[minmax(220px,240px)_minmax(0,1fr)] md:gap-12 xl:gap-16">
            {/* Left: photo + identity + tools */}
            <div className="flex flex-col items-center gap-5 md:items-start">
              <ProfilePhoto />
              <div className="text-center md:text-left">
                <p className="text-sm text-hp-muted">則兼 智志</p>
                <p className="mt-1 text-base font-semibold text-hp md:text-lg">
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
              <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">
                Career
              </p>
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
                      <p className="text-sm font-semibold leading-tight text-hp md:text-base">
                        {item.event}
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-hp-muted md:text-sm md:leading-[1.75]">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Featured Works — horizontal scroll inside profile card */}
          <div className="mt-10 md:mt-12">
            <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">
              Featured Works
            </p>
            <h3 className="mt-2 text-base font-semibold text-hp md:text-lg">
              代表作品
            </h3>

            <div className="mt-6 -mx-8 md:-mx-10 xl:-mx-12 overflow-x-auto">
              <div className="flex snap-x snap-mandatory gap-4 px-8 pb-4 md:gap-5 md:px-10 xl:px-12">
                {featuredWorks.map((work) => (
                  <div
                    key={work.title}
                    className="flex shrink-0 snap-start flex-col glass-card-sm p-4 md:p-5"
                    style={{ width: "min(72vw, 220px)" }}
                  >
                    <p className="text-sm font-semibold leading-snug text-hp md:text-[0.95rem]">
                      {work.title}
                    </p>
                    <p className="mt-auto pt-3 text-xs text-hp-muted md:text-sm">
                      {work.client}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section
        id="contact"
        className="mx-auto w-full max-w-[1440px] px-6 md:px-10 xl:px-14 scroll-mt-24 md:scroll-mt-28 space-y-6"
      >
        <div className="glass-card p-8 md:p-10 xl:p-14">
          <p className="text-xs uppercase tracking-[0.28em] text-hp-muted">Contact</p>
          <h2 className="mt-2 text-2xl font-semibold text-hp md:text-3xl">
            お問い合わせ
          </h2>
          <p className="mt-5 text-base text-hp-muted leading-relaxed md:text-lg">
            お仕事のご相談・ご依頼はフォームよりお気軽にどうぞ。
            <br />
            ご返信の際に、カレンダー予約用のパスワードをお伝えします。
          </p>

          <div className="mt-8">
            <ContactForm />
          </div>
        </div>

      </section>

      <HomeScheduleSection />
    </div>
  )
}
