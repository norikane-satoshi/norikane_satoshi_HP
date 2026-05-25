"use client"

import { Minus, Send, Sparkles } from "lucide-react"

type WidgetShellProps = {
  onMinimize: () => void
}

export function WidgetShell({ onMinimize }: WidgetShellProps) {
  return (
    <section
      className="glass-card pointer-events-auto flex h-[min(560px,calc(100dvh-2rem))] w-full max-w-[384px] animate-in fade-in slide-in-from-bottom-2 duration-300 flex-col overflow-hidden rounded-t-[20px] md:rounded-[20px]"
      aria-label="AI 相談窓口"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--glass-border)] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="glass-badge flex h-10 w-10 shrink-0 items-center justify-center">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-hp">AI アシスタント</p>
            <p className="mt-0.5 truncate text-xs text-hp-muted">
              のりかね映像設計室のご相談窓口
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onMinimize}
          className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center hover:shadow-[0_0_24px_rgba(139,127,255,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
          aria-label="最小化"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <div className="glass-card-sm max-w-[92%] px-4 py-3">
          <p className="text-sm leading-relaxed text-hp">
            ご相談や案件依頼はこちら。最終媒体、公開時期、作業時期などを会話で整理します。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {["カラーグレーディング", "公開時期から逆算", "予約まで進めたい"].map((label) => (
            <span key={label} className="glass-badge px-3 py-2 text-xs">
              {label}
            </span>
          ))}
        </div>
      </div>

      <form
        className="border-t border-[var(--glass-border)] p-4"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="glass-card-sm flex items-center gap-2 px-3 py-2 focus-within:border-[var(--accent-primary)]">
          <input
            className="min-w-0 flex-1 bg-transparent text-sm text-hp outline-none placeholder:text-hp-muted"
            placeholder="相談内容を入力"
            aria-label="相談内容"
          />
          <button
            type="submit"
            className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center hover:shadow-[0_0_24px_rgba(139,127,255,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
            aria-label="送信"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    </section>
  )
}
