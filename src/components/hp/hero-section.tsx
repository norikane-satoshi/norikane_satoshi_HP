export function HeroSection() {
  return (
    <section
      className="relative w-full -mt-24 md:-mt-28"
      style={{
        background: [
          "radial-gradient(ellipse at 18% 18%, rgba(82, 90, 108, 0.18) 0%, transparent 48%)",
          "radial-gradient(ellipse at 82% 76%, rgba(122, 102, 92, 0.14) 0%, transparent 54%)",
          "linear-gradient(135deg, #0E0E10 0%, #151519 45%, #17171B 100%)",
        ].join(", "),
      }}
    >
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-6 pb-10 pt-28 md:px-10 md:pb-14 md:pt-32 xl:px-14">
        <div className="mt-auto grid grid-cols-1 gap-10 md:grid-cols-[1fr_auto] md:items-end md:gap-12">
          <div>
            <h1 className="font-[var(--font-sans)] text-5xl font-bold leading-[0.98] tracking-tight text-white md:text-7xl xl:text-8xl">
              則兼 智志
              <span className="mt-4 block text-2xl font-semibold leading-tight text-white/86 md:text-4xl xl:text-5xl">
                フリーランスカラリスト
              </span>
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
