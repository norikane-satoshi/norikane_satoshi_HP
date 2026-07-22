"use client"

type ThinkingIndicatorProps = {
  showDelayNotice: boolean
}

export function ThinkingIndicator({ showDelayNotice }: ThinkingIndicatorProps) {
  return (
    <article
      className="glass-inset mr-auto max-w-[88%] px-4 py-3 text-sm leading-relaxed text-hp"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold text-hp-muted">
        <span>AI アシスタント</span>
      </div>
      <p className="flex items-center gap-2">
        <span>考え中</span>
        <span className="inline-flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="chatbot-thinking-dot h-1.5 w-1.5 rounded-full bg-[var(--hp-color-accent)]"
              style={{ animationDelay: `${index * 160}ms` }}
            />
          ))}
        </span>
      </p>
      {showDelayNotice ? (
        <p className="mt-1 text-xs text-hp-muted">少々お時間をいただいています…</p>
      ) : null}
    </article>
  )
}
