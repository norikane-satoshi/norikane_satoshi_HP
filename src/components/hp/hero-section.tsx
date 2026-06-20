import {
  HERO_ABSTRACT_ART_BACKGROUND,
  HERO_DEEP_SURFACE_BACKGROUND,
} from "@/components/hp/hero-deep-surface"
import { hpPublicContent } from "@/lib/hp/public-content"

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
      <div className="hp-section-shell relative z-10 flex min-h-screen flex-col pb-[var(--hp-space-5)] pt-28 md:pb-[var(--hp-space-7)] md:pt-32">
        <div className="hp-grid hp-hero-grid mt-auto">
          <div className="hp-hero-title">
            <h1 className="hp-display-heading font-[var(--font-sans)] text-5xl font-bold text-white md:text-7xl xl:text-8xl">
              {hpPublicContent.hero.name}
              <span className="hp-heading mt-4 block text-2xl font-semibold text-white/86 md:text-4xl xl:text-5xl">
                {hpPublicContent.hero.title}
              </span>
            </h1>
            {/* Keep the latin display utility available for a future English locale. */}
          </div>
          <div className="hp-hero-meta text-left font-[var(--font-sans)] md:text-right">
            <p className="text-xs tracking-[0.12em] text-white/70">
              {hpPublicContent.hero.locationLine}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
