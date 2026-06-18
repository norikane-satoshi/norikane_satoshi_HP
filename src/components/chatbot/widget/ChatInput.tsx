"use client"

import { FormEvent, useState } from "react"
import { Send } from "lucide-react"
import {
  CHATBOT_CONVERSATION_CONTENT_CLASS_NAME,
  CHATBOT_CONVERSATION_CONTENT_STYLE,
} from "./conversationTypography"

type ChatInputProps = {
  onSubmit: (text: string) => void
  disabled?: boolean
  placeholder?: string
}

export function ChatInput({ onSubmit, disabled = false, placeholder = "案件内容を書く" }: ChatInputProps) {
  const [text, setText] = useState("")

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedText = text.trim()
    if (disabled || !trimmedText) return
    onSubmit(trimmedText)
    setText("")
  }

  return (
    <form className="border-t border-[var(--glass-border)] p-4" onSubmit={handleSubmit}>
      <div className="glass-card-sm flex items-center gap-2 px-3 py-2 focus-within:border-[var(--accent-primary)]">
        <input
          className={`${CHATBOT_CONVERSATION_CONTENT_CLASS_NAME} min-w-0 flex-1 bg-transparent text-sm text-hp outline-none placeholder:text-hp-muted`}
          style={CHATBOT_CONVERSATION_CONTENT_STYLE}
          placeholder={placeholder}
          aria-label="相談内容"
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="submit"
          className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center hover:shadow-[0_0_24px_rgba(139,127,255,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] disabled:opacity-50"
          aria-label="送信"
          disabled={disabled}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}
