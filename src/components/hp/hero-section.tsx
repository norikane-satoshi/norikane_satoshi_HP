export function HeroSection() {
  return (
    <section
      className="relative w-full -mt-24 md:-mt-28"
      style={{
        background: [
          "radial-gradient(ellipse at 28% 22%, rgba(139, 127, 255, 0.35) 0%, transparent 55%)",
          "radial-gradient(ellipse at 78% 78%, rgba(74, 44, 130, 0.50) 0%, transparent 60%)",
          "linear-gradient(135deg, #1a0a2e 0%, #2d1b69 25%, #1e3a5f 50%, #4a2c82 75%, #1a0a2e 100%)",
        ].join(", "),
      }}
    >
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-6 pb-10 pt-28 md:px-10 md:pb-14 md:pt-32 xl:px-14">
        <p className="text-xs font-medium uppercase tracking-[0.28em] text-white/70">
          デモリール準備中
        </p>

        <div className="mt-auto grid grid-cols-1 gap-10 md:grid-cols-[1fr_auto] md:items-end md:gap-12">
          <div>
            <p className="text-sm text-white/70 md:text-base">則兼 智志</p>
            <h1 className="mt-2 font-[var(--font-sans)] text-5xl font-bold leading-[0.95] tracking-tight text-white md:text-7xl xl:text-8xl">
              フリーランスカラリスト
            </h1>
          </div>
          <div className="text-left font-[var(--font-sans)] md:text-right">
            <p className="text-xs tracking-[0.12em] text-white/70">東京・2026年〜</p>
          </div>
        </div>
      </div>
    </section>
  )
}
