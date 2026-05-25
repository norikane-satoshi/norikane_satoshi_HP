"use client"

import { MessageCircle } from "lucide-react"

type MinimizedBarProps = {
  onOpen: () => void
}

export function MinimizedBar({ onOpen }: MinimizedBarProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-btn pointer-events-auto flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold hover:shadow-[0_0_24px_rgba(139,127,255,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
      aria-label="AI 相談窓口を開く"
    >
      <MessageCircle className="h-5 w-5" aria-hidden="true" />
      <span>ご相談窓口</span>
    </button>
  )
}
