"use client"

import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useState } from "react"
import { GripHorizontal, Minus, PanelRightOpen, Sparkles } from "lucide-react"

import type { ChatbotMessageRole } from "@/lib/chatbot/domain/conversation"
import type { WidgetDisplayMode } from "./useWidgetState"

import {
  submitChatbotInquiry,
  submitChatbotMessage,
  type ChatbotResponseTier,
  type SubmitInquiryInput,
  type WidgetUi,
} from "./api"
import { ChatInput } from "./ChatInput"
import { ChatMessage } from "./ChatMessage"
import { ChatbotBookingCard } from "./ChatbotBookingCard"
import { ChoicePanel } from "./ChoicePanel"
import { DirectContactCard } from "./DirectContactCard"
import { InquiryForm } from "./InquiryForm"
import { formatChatbotTierDebugLabel, isLocalChatbotTierDebugHostname } from "./local-tier-debug"
import { SecurityNote } from "./SecurityNote"
import { ThinkingIndicator } from "./ThinkingIndicator"

type WidgetShellProps = {
  onMinimize: () => void
  displayMode?: WidgetDisplayMode
  isDesktopLayout?: boolean
  onFloatingResizeBy?: (deltaWidth: number, deltaHeight: number) => void
  onFloatingResizePointerDown?: (event: ReactPointerEvent<HTMLElement>) => void
  onHeaderPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void
  onSidePeekResizeBy?: (deltaWidth: number) => void
  onSidePeekResizePointerDown?: (event: ReactPointerEvent<HTMLElement>) => void
  onToggleDisplayMode?: () => void
}

type WidgetMessage = {
  role: ChatbotMessageRole
  content: string
  createdAt: Date
}

const initialMessage = {
  role: "assistant",
  content: "ご相談や案件依頼はこちらです。最終媒体、公開時期、作業時期などを会話で整理します。",
  createdAt: new Date(),
} satisfies WidgetMessage

const noUi = { kind: "none" } satisfies WidgetUi
const networkErrorMessage = "通信に失敗しました。少し時間をおいてもう一度お試しください。"
const inquirySentMessage = "送信しました。担当者からの返信をお待ちください。"
const CHATBOT_SESSION_STORAGE_KEY = "hp-chatbot-session-v1"
const CHATBOT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const thinkingDelayNoticeMs = 6000

type StoredWidgetSession = {
  messages: Array<Omit<WidgetMessage, "createdAt"> & { createdAt: string }>
  conversationId?: string
  activeUi: WidgetUi
  lastResponseTier?: ChatbotResponseTier
  expiresAt: string
}

function getInitialWidgetSession() {
  return {
    messages: [initialMessage],
    activeUi: noUi,
  }
}

function removeStoredWidgetSession() {
  try {
    window.localStorage.removeItem(CHATBOT_SESSION_STORAGE_KEY)
  } catch {
    // localStorage may be unavailable in private or restricted contexts.
  }
}

function loadStoredWidgetSession(): {
  messages: WidgetMessage[]
  conversationId?: string
  activeUi: WidgetUi
  lastResponseTier?: ChatbotResponseTier
} {
  if (typeof window === "undefined") return getInitialWidgetSession()

  try {
    const raw = window.localStorage.getItem(CHATBOT_SESSION_STORAGE_KEY)
    if (!raw) return getInitialWidgetSession()

    const parsed = JSON.parse(raw) as Partial<StoredWidgetSession>
    if (!parsed.expiresAt || new Date(parsed.expiresAt).getTime() <= Date.now()) {
      removeStoredWidgetSession()
      return getInitialWidgetSession()
    }

    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .filter((message) => message.role && typeof message.content === "string" && message.createdAt)
          .map((message) => ({
            role: message.role,
            content: message.content,
            createdAt: new Date(message.createdAt),
          }))
      : []

    return {
      messages: messages.length > 0 ? messages : [initialMessage],
      conversationId: parsed.conversationId,
      activeUi: parsed.activeUi ?? noUi,
      lastResponseTier: parsed.lastResponseTier,
    }
  } catch {
    removeStoredWidgetSession()
    return getInitialWidgetSession()
  }
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("a,button,input,select,textarea"))
}

export function WidgetShell({
  displayMode = "floating",
  isDesktopLayout = false,
  onFloatingResizeBy,
  onFloatingResizePointerDown,
  onHeaderPointerDown,
  onMinimize,
  onSidePeekResizeBy,
  onSidePeekResizePointerDown,
  onToggleDisplayMode,
}: WidgetShellProps) {
  const [messages, setMessages] = useState<WidgetMessage[]>(() => getInitialWidgetSession().messages)
  const [conversationId, setConversationId] = useState<string | undefined>(undefined)
  const [activeUi, setActiveUi] = useState<WidgetUi>(noUi)
  const [submitting, setSubmitting] = useState(false)
  const [showThinkingDelayNotice, setShowThinkingDelayNotice] = useState(false)
  const [lastResponseTier, setLastResponseTier] = useState<ChatbotResponseTier | undefined>(undefined)
  const [hasRestoredSession, setHasRestoredSession] = useState(false)
  const showLocalTierDebug =
    typeof window !== "undefined" && isLocalChatbotTierDebugHostname(window.location.hostname)

  const appendMessage = (message: WidgetMessage) => {
    setMessages((currentMessages) => [...currentMessages, message])
  }

  useEffect(() => {
    if (!submitting) return

    const timeoutId = window.setTimeout(() => {
      setShowThinkingDelayNotice(true)
    }, thinkingDelayNoticeMs)

    return () => window.clearTimeout(timeoutId)
  }, [submitting])

  useEffect(() => {
    const storedSession = loadStoredWidgetSession()
    /* eslint-disable react-hooks/set-state-in-effect -- localStorage restore must run after hydration before the first save. */
    setMessages(storedSession.messages)
    setConversationId(storedSession.conversationId)
    setActiveUi(storedSession.activeUi)
    setLastResponseTier(storedSession.lastResponseTier)
    setHasRestoredSession(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  useEffect(() => {
    if (!hasRestoredSession) return

    try {
      const stored: StoredWidgetSession = {
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
        })),
        conversationId,
        activeUi,
        lastResponseTier,
        expiresAt: new Date(Date.now() + CHATBOT_SESSION_TTL_MS).toISOString(),
      }
      window.localStorage.setItem(CHATBOT_SESSION_STORAGE_KEY, JSON.stringify(stored))
    } catch {
      // localStorage may be unavailable in private or restricted contexts.
    }
  }, [activeUi, conversationId, hasRestoredSession, lastResponseTier, messages])

  const handleSubmit = async (text: string) => {
    const createdAt = new Date()
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content: text, createdAt },
    ])
    setActiveUi(noUi)
    setShowThinkingDelayNotice(false)
    setSubmitting(true)

    try {
      const payload = await submitChatbotMessage({ message: text, conversationId })
      setConversationId(payload.conversationId)
      setLastResponseTier(payload.tier)
      appendMessage({
        role: payload.assistantMessage.role,
        content: payload.assistantMessage.content,
        createdAt: new Date(payload.assistantMessage.createdAt),
      })
      setActiveUi(payload.ui)
    } catch {
      appendMessage({
        role: "system",
        content: networkErrorMessage,
        createdAt: new Date(),
      })
    } finally {
      setShowThinkingDelayNotice(false)
      setSubmitting(false)
    }
  }

  const handleInquirySubmit = async (input: Omit<SubmitInquiryInput, "conversationId">) => {
    try {
      await submitChatbotInquiry({ ...input, conversationId })
      appendMessage({
        role: "assistant",
        content: inquirySentMessage,
        createdAt: new Date(),
      })
      setActiveUi(noUi)
    } catch {
      appendMessage({
        role: "system",
        content: networkErrorMessage,
        createdAt: new Date(),
      })
    }
  }

  const isSidePeek = isDesktopLayout && displayMode === "side-peek"
  const isFloating = isDesktopLayout && displayMode === "floating"
  const shellSizeClassName = isDesktopLayout
    ? "h-full w-full max-w-none rounded-[20px]"
    : "h-[min(560px,calc(100dvh-2rem))] w-full max-w-[384px] rounded-t-[20px] md:rounded-[20px]"

  const handleHeaderPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isFloating || isInteractiveTarget(event.target)) return
    onHeaderPointerDown?.(event)
  }

  const handleFloatingResizeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!isFloating) return
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [0, -KEYBOARD_RESIZE_STEP],
      ArrowDown: [0, KEYBOARD_RESIZE_STEP],
      ArrowLeft: [-KEYBOARD_RESIZE_STEP, 0],
      ArrowRight: [KEYBOARD_RESIZE_STEP, 0],
    }
    const delta = deltas[event.key]
    if (!delta) return
    event.preventDefault()
    onFloatingResizeBy?.(delta[0], delta[1])
  }

  const handleSidePeekResizeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!isSidePeek) return
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    onSidePeekResizeBy?.(event.key === "ArrowLeft" ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP)
  }

  return (
    <section
      className={`glass-card glass-card--chat-frost pointer-events-auto relative flex animate-in fade-in slide-in-from-bottom-2 flex-col overflow-hidden duration-300 ${shellSizeClassName}`}
      style={{
        background: "rgba(255, 255, 255, 0.72)",
        backdropFilter: "blur(32px) saturate(130%)",
        WebkitBackdropFilter: "blur(32px) saturate(130%)",
      }}
      aria-label="AI 相談窓口"
    >
      {isSidePeek ? (
        <button
          type="button"
          onPointerDown={onSidePeekResizePointerDown}
          onKeyDown={handleSidePeekResizeKeyDown}
          className="absolute inset-y-0 left-0 z-20 flex w-4 cursor-ew-resize items-center justify-center text-hp-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent-primary)]"
          aria-label="サイドピーク幅を変更"
        >
          <GripHorizontal className="h-5 w-5 rotate-90" aria-hidden="true" />
        </button>
      ) : null}
      <div
        className={`flex items-center justify-between gap-3 border-b border-[var(--glass-border)] px-5 py-4 ${isFloating ? "cursor-move select-none" : ""}`}
        onPointerDown={handleHeaderPointerDown}
      >
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
        <div className="flex shrink-0 items-center gap-2">
          {isDesktopLayout ? (
            <button
              type="button"
              onClick={onToggleDisplayMode}
              className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center hover:shadow-[0_0_24px_rgba(139,127,255,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
              aria-label={displayMode === "side-peek" ? "フローティング表示に切り替え" : "サイドピーク表示に切り替え"}
            >
              <PanelRightOpen className={`h-4 w-4 ${displayMode === "side-peek" ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onMinimize}
            className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center hover:shadow-[0_0_24px_rgba(139,127,255,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
            aria-label="最小化"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      {showLocalTierDebug && lastResponseTier ? (
        <div className="border-b border-[var(--glass-border)] px-5 py-2">
          <p className="glass-badge inline-flex max-w-full px-3 py-1 text-[11px] font-medium">
            Local debug: {formatChatbotTierDebugLabel(lastResponseTier)}
          </p>
        </div>
      ) : null}

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <SecurityNote defaultOpen={false} />
        <div className="space-y-3" role="log" aria-live="polite">
          {messages.map((message, index) => (
            <ChatMessage
              key={`${message.role}-${message.createdAt.toISOString()}-${index}`}
              role={message.role}
              content={message.content}
              createdAt={message.createdAt}
            />
          ))}
          {submitting ? <ThinkingIndicator showDelayNotice={showThinkingDelayNotice} /> : null}
        </div>
        <ActiveWidgetUi ui={activeUi} conversationId={conversationId} onSubmit={handleSubmit} onInquirySubmit={handleInquirySubmit} />
      </div>

      <ChatInput onSubmit={handleSubmit} disabled={submitting} />
      {isFloating ? (
        <button
          type="button"
          onPointerDown={onFloatingResizePointerDown}
          onKeyDown={handleFloatingResizeKeyDown}
          className="absolute bottom-0 right-0 z-20 h-8 w-8 cursor-nwse-resize bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent-primary)]"
          aria-label="パネルを拡大・縮小"
        />
      ) : null}
    </section>
  )
}

const KEYBOARD_RESIZE_STEP = 16

function ActiveWidgetUi({
  ui,
  conversationId,
  onSubmit,
  onInquirySubmit,
}: {
  ui: WidgetUi
  conversationId?: string
  onSubmit: (text: string) => void
  onInquirySubmit: (input: Omit<SubmitInquiryInput, "conversationId">) => void
}) {
  if (ui.kind === "choice-panel") {
    return (
      <ChoicePanel
        choiceSet={ui.choiceSet}
        onSelect={(selectedIds) => onSubmit(`選択: ${selectedIds.join(", ")}`)}
      />
    )
  }

  if (ui.kind === "booking-card") {
    return (
      <ChatbotBookingCard
        conversationId={conversationId}
        candidates={ui.suggestedSlots}
        estimate={ui.jobContext.workflowEstimate}
        defaultProjectTitle={ui.bookingPrefill?.projectTitle}
        defaultContactName={ui.bookingPrefill?.contactName}
        defaultCompanyName={ui.bookingPrefill?.companyName}
        defaultDueDate={ui.bookingPrefill?.dueDate ?? ui.jobContext.publicReleaseDate}
        defaultMemo={ui.jobContext.referenceUrls?.join("\n")}
      />
    )
  }

  if (ui.kind === "direct-contact-card") {
    return (
      <DirectContactCard
        reason={ui.reason}
        suggestedMessage={ui.suggestedMessage}
        onSubmitEmail={(email, companyName, personName) =>
          onInquirySubmit({
            name: personName || "未入力",
            email,
            jobType: ui.reason,
            duration: "",
            desiredDeadline: "",
            freeText: [companyName, ui.suggestedMessage].filter(Boolean).join("\n"),
          })
        }
      />
    )
  }

  if (ui.kind === "tier4-inquiry-form") {
    return <InquiryForm onSubmit={onInquirySubmit} />
  }

  return null
}
