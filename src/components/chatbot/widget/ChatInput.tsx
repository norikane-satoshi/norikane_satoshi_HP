"use client"

import { FormEvent, KeyboardEvent, useLayoutEffect, useState } from "react"
import { Send, Square } from "lucide-react"
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea"
import {
  CHATBOT_CONVERSATION_CONTENT_CLASS_NAME,
  CHATBOT_CONVERSATION_CONTENT_STYLE,
} from "./conversationTypography"

type ChatInputProps = {
  onSubmit: (text: string) => void
  onStop?: () => void
  disabled?: boolean
  stoppingEnabled?: boolean
  placeholder?: string
}

const DESKTOP_DEFAULT_PLACEHOLDER = "案件内容を書く（Enterで改行、Cmd（Ctrl）+ Enterで送信）"
const MOBILE_DEFAULT_PLACEHOLDER = "案件内容を書く"
const MOBILE_HINT_MEDIA_QUERY = "(pointer: coarse), (max-width: 767px)"

export function ChatInput({
  onSubmit,
  onStop,
  disabled = false,
  stoppingEnabled = false,
  placeholder,
}: ChatInputProps) {
  const [text, setText] = useState("")
  const [usesMobilePlaceholder, setUsesMobilePlaceholder] = useState(false)

  useLayoutEffect(() => {
    if (placeholder !== undefined) return
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return

    const mediaQuery = window.matchMedia(MOBILE_HINT_MEDIA_QUERY)
    const syncPlaceholder = () => setUsesMobilePlaceholder(mediaQuery.matches)

    syncPlaceholder()
    mediaQuery.addEventListener?.("change", syncPlaceholder)
    return () => mediaQuery.removeEventListener?.("change", syncPlaceholder)
  }, [placeholder])

  const textareaPlaceholder =
    placeholder ?? (usesMobilePlaceholder ? MOBILE_DEFAULT_PLACEHOLDER : DESKTOP_DEFAULT_PLACEHOLDER)

  const submitCurrentText = () => {
    const trimmedText = text.trim()
    if (disabled || !trimmedText) return false
    onSubmit(trimmedText)
    setText("")
    return true
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitCurrentText()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return
    event.preventDefault()
    submitCurrentText()
  }

  return (
    <form className="border-t border-[var(--glass-border)] p-4" onSubmit={handleSubmit}>
      <div className="glass-card-sm flex items-end gap-2 px-3 py-2 focus-within:border-[var(--accent-primary)]">
        <AutoResizeTextarea
          className={`${CHATBOT_CONVERSATION_CONTENT_CLASS_NAME} min-h-9 min-w-0 flex-1 bg-transparent py-2 text-sm leading-5 text-hp outline-none placeholder:text-hp-muted`}
          style={CHATBOT_CONVERSATION_CONTENT_STYLE}
          placeholder={textareaPlaceholder}
          aria-label="相談内容"
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        {stoppingEnabled ? (
          <button
            type="button"
            className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center hover:shadow-[0_0_24px_color-mix(in_srgb,var(--hp-color-accent)_30%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
            aria-label="停止"
            onClick={onStop}
          >
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center hover:shadow-[0_0_24px_color-mix(in_srgb,var(--hp-color-accent)_30%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] disabled:opacity-50"
            aria-label="送信"
            disabled={disabled}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  )
}
