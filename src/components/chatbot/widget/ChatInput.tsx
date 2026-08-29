"use client"

import { FormEvent, KeyboardEvent, useLayoutEffect, useState } from "react"
import type { ReactNode, RefObject } from "react"
import { Command, CornerDownLeft, Send, Square } from "lucide-react"
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea"
import {
  CHATBOT_CONVERSATION_CONTENT_CLASS_NAME,
  CHATBOT_CONVERSATION_CONTENT_STYLE,
} from "./conversationTypography"
import {useChatbotCopy} from "./i18n"

type ChatInputProps = {
  onSubmit: (text: string) => void
  onStop?: () => void
  disabled?: boolean
  stoppingEnabled?: boolean
  placeholder?: string
  inputRef?: RefObject<HTMLTextAreaElement | null>
}

const MOBILE_HINT_MEDIA_QUERY = "(pointer: coarse), (max-width: 767px)"

function isMacPlatform() {
  if (typeof window === "undefined") return true

  const platform = window.navigator.platform.toLowerCase()
  return platform.includes("mac") || platform.includes("iphone") || platform.includes("ipad")
}

function matchesMobileHintMedia() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia(MOBILE_HINT_MEDIA_QUERY).matches
}

function ShortcutKeycap({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] border border-white/65 bg-white/45 px-1.5 text-[10px] font-semibold leading-none text-hp">
      <span className="inline-flex items-center justify-center opacity-60">{children}</span>
    </span>
  )
}

export function ChatInput({
  onSubmit,
  onStop,
  disabled = false,
  stoppingEnabled = false,
  placeholder,
  inputRef,
}: ChatInputProps) {
  const copy = useChatbotCopy()
  const [text, setText] = useState("")
  const [usesMobilePlaceholder, setUsesMobilePlaceholder] = useState(() =>
    placeholder === undefined ? matchesMobileHintMedia() : false,
  )
  const [usesMacShortcut] = useState(isMacPlatform)

  useLayoutEffect(() => {
    if (placeholder !== undefined) return
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return

    const mediaQuery = window.matchMedia(MOBILE_HINT_MEDIA_QUERY)
    const syncPlaceholder = () => setUsesMobilePlaceholder(mediaQuery.matches)

    syncPlaceholder()
    mediaQuery.addEventListener?.("change", syncPlaceholder)
    return () => mediaQuery.removeEventListener?.("change", syncPlaceholder)
  }, [placeholder])

  const textareaPlaceholder = placeholder ?? copy.inputPlaceholder
  const showsDefaultShortcutHint = placeholder === undefined && !usesMobilePlaceholder
  const showsShortcutOverlay = showsDefaultShortcutHint && text.length === 0

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
      <div className="glass-card-sm flex items-end gap-2 px-3 py-2 focus-within:border-[var(--hp-color-accent)]">
        <div className={`relative min-w-0 flex-1 ${showsShortcutOverlay ? "min-h-[4.75rem]" : ""}`}>
          {showsShortcutOverlay ? (
            <div
              className={`${CHATBOT_CONVERSATION_CONTENT_CLASS_NAME} pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-wrap items-center gap-x-4 gap-y-1.5 py-2 text-sm leading-5 text-hp-muted`}
              style={CHATBOT_CONVERSATION_CONTENT_STYLE}
              aria-hidden="true"
            >
              <span className="opacity-60">{copy.inputPlaceholder}</span>
              <span className="inline-flex items-center gap-1">
                <ShortcutKeycap>
                  <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" data-chat-input-key="newline" />
                </ShortcutKeycap>
                <span className="opacity-60">{copy.newlineHint}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-flex items-center gap-px">
                  <ShortcutKeycap>
                    {usesMacShortcut ? (
                      <Command className="h-3.5 w-3.5" aria-hidden="true" data-chat-input-key="command" />
                    ) : (
                      <span data-chat-input-key="control">Ctrl</span>
                    )}
                  </ShortcutKeycap>
                  <span className="text-hp-muted/70">+</span>
                  <ShortcutKeycap>
                    <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" data-chat-input-key="submit-enter" />
                  </ShortcutKeycap>
                </span>
                <span className="opacity-60">{copy.sendHint}</span>
              </span>
            </div>
          ) : null}
          <AutoResizeTextarea
            ref={inputRef}
            className={`${CHATBOT_CONVERSATION_CONTENT_CLASS_NAME} relative z-10 w-full min-w-0 bg-transparent py-2 text-sm leading-5 text-hp outline-none ${showsShortcutOverlay ? "min-h-[4.75rem] placeholder:text-transparent" : "chatbot-input-placeholder-muted min-h-9"}`}
            style={CHATBOT_CONVERSATION_CONTENT_STYLE}
            placeholder={textareaPlaceholder}
            aria-label={copy.inputLabel}
            value={text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />
        </div>
        {stoppingEnabled ? (
          <button
            type="button"
            className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hp-color-accent-focus-outline)]"
            aria-label={copy.stop}
            onClick={onStop}
          >
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hp-color-accent-focus-outline)] disabled:opacity-50"
            aria-label={copy.send}
            disabled={disabled}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  )
}
