import {
  HERO_ABSTRACT_ART_BACKGROUND,
  HERO_DEEP_SURFACE_BACKGROUND,
} from "@/components/hp/hero-deep-surface"

export function HeroSection() {
  return (
    <section
      id="home"
      className="relative w-full -mt-24 md:-mt-28"
      style={{ background: HERO_DEEP_SURFACE_BACKGROUND }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[-10%] top-16 h-[74vh] opacity-55 blur-3xl md:top-20 md:h-[78vh]"
        data-hp-abstract-art="hero"
        style={{ background: HERO_ABSTRACT_ART_BACKGROUND }}
      />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-6 pb-10 pt-28 md:px-10 md:pb-14 md:pt-32 xl:px-14">
        <div className="mt-auto grid grid-cols-1 gap-10 md:grid-cols-[1fr_auto] md:items-end md:gap-12">
          <div>
            <h1 className="hp-display-heading font-[var(--font-sans)] text-5xl font-bold text-white md:text-7xl xl:text-8xl">
              則兼 智志
              <span className="hp-heading mt-4 block text-2xl font-semibold text-white/86 md:text-4xl xl:text-5xl">
                フリーランスカラリスト
              </span>
            </h1>
            {/* Keep the latin display utility available for a future English locale. */}
          </div>
          <div className="text-left font-[var(--font-sans)] md:text-right">
            <p className="text-xs tracking-[0.12em] text-white/70">東京・2026年〜</p>
          </div>
        </div>
      </div>
    </section>
  )
}
