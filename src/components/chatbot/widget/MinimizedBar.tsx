"use client"

import { MessageCircle } from "lucide-react"
import {useChatbotCopy} from "./i18n"

type MinimizedBarProps = {
  onOpen: () => void
  shouldShowAttention?: boolean
}

export function MinimizedBar({ onOpen, shouldShowAttention = false }: MinimizedBarProps) {
  const copy = useChatbotCopy()
  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        "glass-btn pointer-events-auto flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hp-color-accent-focus-outline)]",
        shouldShowAttention ? "chatbot-minimized-attention" : "",
      ].filter(Boolean).join(" ")}
      data-attention={shouldShowAttention ? "true" : "false"}
      aria-label={copy.open}
    >
      <MessageCircle className="h-5 w-5" aria-hidden="true" />
      <span>{copy.launcher}</span>
    </button>
  )
}
