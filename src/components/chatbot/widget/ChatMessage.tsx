"use client"

import type { ChatbotMessageRole } from "@/lib/chatbot/domain/conversation"

type ChatMessageProps = {
  role: ChatbotMessageRole
  content: string
  createdAt?: Date
}

const roleLabel: Record<ChatbotMessageRole, string> = {
  user: "お客さま",
  assistant: "AI アシスタント",
  system: "システム",
}

export function ChatMessage({ role, content, createdAt }: ChatMessageProps) {
  const isUser = role === "user"
  const isSystem = role === "system"

  return (
    <article
      className={[
        "max-w-[88%] px-4 py-3 text-sm leading-relaxed",
        isUser
          ? "glass-flat ml-auto border border-[var(--accent-primary)]/40 text-hp"
          : "glass-inset mr-auto text-hp",
        isSystem ? "mx-auto max-w-full text-xs text-hp-muted" : "",
      ].join(" ")}
    >
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold text-hp-muted">
        <span>{roleLabel[role]}</span>
        {createdAt ? (
          <time dateTime={createdAt.toISOString()}>
            {createdAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
          </time>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap">{content}</p>
    </article>
  )
}
