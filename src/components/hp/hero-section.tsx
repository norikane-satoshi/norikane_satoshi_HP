import Link from "next/link"
import { ArrowRight, MessageCircle } from "lucide-react"
import { SITE_TAGLINE } from "@/lib/site-brand"

export function HeroSection() {
  return (
    <section
      id="home"
      className="hp-hero-stage relative w-full -mt-24 overflow-hidden md:-mt-28"
      aria-label="主要メッセージ"
    >
      <div className="relative mx-auto flex min-h-[clamp(520px,76dvh,780px)] w-full max-w-[1440px] flex-col justify-end px-6 pb-12 pt-28 md:px-10 md:pb-16 md:pt-32 xl:px-14">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-end">
          <div className="max-w-4xl">
            <p className="hp-hero-kicker text-white/68">Color Grading / Look Design</p>
            <h1 className="hp-display-heading mt-4 font-[var(--font-sans)] text-5xl font-bold text-white md:text-7xl xl:text-8xl">
              則兼 智志
              <span className="hp-heading mt-4 block text-2xl font-semibold text-white/84 md:text-4xl xl:text-5xl">
                フリーランスカラリスト
              </span>
            </h1>
            {/* Keep the latin display utility available for a future English locale. */}
            <p className="hp-hero-tagline mt-7 text-xl font-semibold text-white md:text-2xl">
              {SITE_TAGLINE}
            </p>
            <p className="hp-body mt-4 max-w-[34rem] text-sm text-white/72 md:text-base">
              作品の意図を読み、色設計から納品まで静かに整えるカラリストです。
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="#contact"
                className="hp-hero-cta hp-hero-cta-primary inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold"
              >
                <MessageCircle className="h-4 w-4" strokeWidth={1.8} />
                AI 相談窓口
              </Link>
              <Link
                href="/#philosophy"
                className="hp-hero-cta inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold"
              >
                ノートを読む
                <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
              </Link>
            </div>
          </div>
          <aside className="hp-hero-rail font-[var(--font-sans)] text-white/72" aria-label="対応領域">
            <p className="text-xs text-white/58">東京・2026年〜</p>
            <dl className="mt-4 space-y-4 text-sm">
              <div>
                <dt className="text-white">DaVinci Resolve / ACES</dt>
                <dd className="mt-1 text-white/58">劇場映画・配信・CM・MV</dd>
              </div>
              <div>
                <dt className="text-white">Remote / Studio</dt>
                <dd className="mt-1 text-white/58">立ち会い・リモート両対応</dd>
              </div>
            </dl>
          </aside>
        </div>
      </div>
    </section>
  )
}
