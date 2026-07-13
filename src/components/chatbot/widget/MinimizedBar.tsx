"use client"

import { MessageCircle } from "lucide-react"

type MinimizedBarProps = {
  onOpen: () => void
  shouldShowAttention?: boolean
}

export function MinimizedBar({ onOpen, shouldShowAttention = false }: MinimizedBarProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        "glass-btn pointer-events-auto flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold hover:shadow-[0_0_24px_color-mix(in_srgb,var(--hp-color-accent)_30%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]",
        shouldShowAttention ? "chatbot-minimized-attention" : "",
      ].filter(Boolean).join(" ")}
      data-attention={shouldShowAttention ? "true" : "false"}
      aria-label="AI 相談窓口を開く"
    >
      <MessageCircle className="h-5 w-5" aria-hidden="true" />
      <span>ご相談窓口</span>
    </button>
  )
}
