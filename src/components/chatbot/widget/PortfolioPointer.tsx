"use client"

type PortfolioPointerProps = {
  worksSectionUrl?: string
}

export function PortfolioPointer({ worksSectionUrl = "/#works" }: PortfolioPointerProps) {
  return (
    <aside className="glass-inset p-4" aria-label="Works セクション案内">
      <p className="text-sm font-semibold text-hp">Works セクションも確認できます。</p>
      <a
        className="mt-2 inline-flex text-sm font-semibold text-hp underline decoration-dotted underline-offset-4 hover:text-[var(--accent-primary)]"
        href={worksSectionUrl}
      >
        norikane.studio Works を見る
      </a>
    </aside>
  )
}
