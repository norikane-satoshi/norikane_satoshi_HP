export function HeroSection() {
  return (
    <section
      id="home"
      className="hp-hero-stage relative w-full -mt-24 overflow-hidden md:-mt-28"
    >
      <div className="relative mx-auto flex min-h-[clamp(560px,82dvh,820px)] w-full max-w-[1440px] flex-col px-6 pb-10 pt-28 md:px-10 md:pb-14 md:pt-32 xl:px-14">
        <div className="grid flex-1 grid-cols-1 gap-10 md:grid-cols-[minmax(0,1fr)_minmax(160px,0.28fr)] md:items-end xl:gap-14">
          <div className="hp-hero-composition mt-auto">
            <p className="hp-hero-kicker text-white/66">デモリール準備中</p>

            <div className="mt-16 md:mt-24">
              <p className="text-sm text-white/70 md:text-base">則兼 智志</p>
              <h1 className="hp-display-heading mt-3 max-w-[12ch] font-[var(--font-sans)] text-[clamp(3.25rem,7.2vw,6.2rem)] font-bold text-white">
              フリーランスカラリスト
              </h1>
            </div>
          </div>
          <div className="grid gap-5 md:justify-items-end">
            <div className="hp-hero-frame w-full md:w-[min(28vw,20rem)]" aria-hidden="true" />
            <div className="hp-hero-rail w-full font-[var(--font-sans)] md:w-[min(28vw,20rem)] md:text-right">
              <p className="text-xs text-white/58">東京・2026年〜</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
