"use client"

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { Minus, PanelRightClose, PanelRightOpen, Sparkles } from "lucide-react"

import type { ChatbotMessageRole } from "@/lib/chatbot/domain/conversation"

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
import {
  CHATBOT_WIDGET_MIN_HEIGHT,
  CHATBOT_WIDGET_MIN_WIDTH,
  getWidgetLayoutBounds,
  sanitizeWidgetLayout,
  type WidgetLayout,
  type WidgetMode,
  type WidgetPosition,
  type WidgetSize,
} from "./useWidgetState"

type WidgetShellProps = {
  onMinimize: () => void
  layout: WidgetLayout
  onModeChange: (mode: WidgetMode) => void
  onFloatingGeometryChange: (geometry: { position?: WidgetPosition; size?: WidgetSize }) => void
  onSidePeekWidthChange: (width: number) => void
}

type WidgetMessage = {
  id?: string
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
const inquirySentMessage = "送信しました。のりかね本人が確認して返信します。"
const CHATBOT_SESSION_STORAGE_KEY = "hp-chatbot-session-v1"
const CHATBOT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const thinkingDelayNoticeMs = 6000
const CHATBOT_SIDE_PEEK_OCCUPIED_WIDTH_VAR = "--chatbot-side-peek-occupied-width"
const FOCUS_RING_CLASS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
const FLOATING_RESIZE_CORNERS = [
  { edge: "se", className: "bottom-0 right-0 h-5 w-5 cursor-nwse-resize" },
  { edge: "sw", className: "bottom-0 left-0 h-5 w-5 cursor-nesw-resize" },
  { edge: "ne", className: "right-0 top-0 h-5 w-5 cursor-nesw-resize" },
  { edge: "nw", className: "left-0 top-0 h-5 w-5 cursor-nwse-resize" },
] as const

type StoredWidgetSession = {
  messages: Array<Omit<WidgetMessage, "createdAt"> & { createdAt: string }>
  conversationId?: string
  activeUi: WidgetUi
  lastResponseTier?: ChatbotResponseTier
  expiresAt: string
}

function loadStoredWidgetSession(): {
  messages: WidgetMessage[]
  conversationId?: string
  activeUi: WidgetUi
  lastResponseTier?: ChatbotResponseTier
} {
  if (typeof window === "undefined") {
    return { messages: [initialMessage], activeUi: noUi }
  }

  try {
    const raw = window.localStorage.getItem(CHATBOT_SESSION_STORAGE_KEY)
    if (!raw) return { messages: [initialMessage], activeUi: noUi }
    const parsed = JSON.parse(raw) as Partial<StoredWidgetSession>
    if (!parsed.expiresAt || new Date(parsed.expiresAt).getTime() <= Date.now()) {
      window.localStorage.removeItem(CHATBOT_SESSION_STORAGE_KEY)
      return { messages: [initialMessage], activeUi: noUi }
    }
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .filter((message) => message.role && typeof message.content === "string" && message.createdAt)
          .map((message) => ({
            id: typeof message.id === "string" ? message.id : undefined,
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
    window.localStorage.removeItem(CHATBOT_SESSION_STORAGE_KEY)
    return { messages: [initialMessage], activeUi: noUi }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("button, a, input, textarea, select, label"))
}

function buildInquirySummaryMessage(input: Omit<SubmitInquiryInput, "conversationId">): string {
  const fields = [
    ["メール", input.email],
    ["氏名", input.name],
    ["案件種別", input.jobType],
    ["尺", input.duration],
    ["希望納期", input.desiredDeadline],
    ["自由記述", input.freeText],
  ].filter(([, value]) => value.trim())

  return ["送信内容", ...fields.map(([label, value]) => `- ${label}: ${value.trim()}`)].join("\n")
}

export function WidgetShell({
  onMinimize,
  layout,
  onModeChange,
  onFloatingGeometryChange,
  onSidePeekWidthChange,
}: WidgetShellProps) {
  const [storedSession] = useState(loadStoredWidgetSession)
  const [messages, setMessages] = useState<WidgetMessage[]>(storedSession.messages)
  const [conversationId, setConversationId] = useState<string | undefined>(storedSession.conversationId)
  const [activeUi, setActiveUi] = useState<WidgetUi>(storedSession.activeUi)
  const [submitting, setSubmitting] = useState(false)
  const [lastResponseTier, setLastResponseTier] = useState<ChatbotResponseTier | undefined>(storedSession.lastResponseTier)
  const [showThinkingDelayNotice, setShowThinkingDelayNotice] = useState(false)
  const shellRef = useRef<HTMLElement | null>(null)
  const showLocalTierDebug =
    typeof window !== "undefined" && isLocalChatbotTierDebugHostname(window.location.hostname)
  const sanitizedLayout = useMemo(() => sanitizeWidgetLayout(layout), [layout])
  const isSidePeek = sanitizedLayout.mode === "side-peek"
  const shellStyle = {
    "--chatbot-widget-x": `${sanitizedLayout.floatingPosition.x}px`,
    "--chatbot-widget-y": `${sanitizedLayout.floatingPosition.y}px`,
    "--chatbot-widget-width": `${sanitizedLayout.floatingSize.width}px`,
    "--chatbot-widget-height": `${sanitizedLayout.floatingSize.height}px`,
    "--chatbot-side-peek-width": `${sanitizedLayout.sidePeekWidth}px`,
  } as CSSProperties

  useEffect(() => {
    const root = document.documentElement
    const mediaQuery =
      typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 768px)") : null
    const getIsDesktop = () => (mediaQuery ? mediaQuery.matches : window.innerWidth >= 768)
    const syncOccupiedWidth = () => {
      root.style.setProperty(
        CHATBOT_SIDE_PEEK_OCCUPIED_WIDTH_VAR,
        isSidePeek && getIsDesktop() ? `${sanitizedLayout.sidePeekWidth}px` : "0px",
      )
    }

    syncOccupiedWidth()
    mediaQuery?.addEventListener("change", syncOccupiedWidth)
    window.addEventListener("resize", syncOccupiedWidth)

    return () => {
      mediaQuery?.removeEventListener("change", syncOccupiedWidth)
      window.removeEventListener("resize", syncOccupiedWidth)
      root.style.setProperty(CHATBOT_SIDE_PEEK_OCCUPIED_WIDTH_VAR, "0px")
    }
  }, [isSidePeek, sanitizedLayout.sidePeekWidth])

  useEffect(() => {
    try {
      const stored: StoredWidgetSession = {
        messages: messages.map((message) => ({
          ...(message.id ? { id: message.id } : {}),
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
  }, [activeUi, conversationId, lastResponseTier, messages])

  const startFloatingMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (isSidePeek || isInteractiveTarget(event.target)) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const initialPosition = sanitizedLayout.floatingPosition
    const size = sanitizedLayout.floatingSize

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const bounds = getWidgetLayoutBounds()
      onFloatingGeometryChange({
        position: {
          x: clamp(initialPosition.x + moveEvent.clientX - startX, bounds.minX, Math.max(bounds.minX, window.innerWidth - size.width - bounds.minX)),
          y: clamp(initialPosition.y + moveEvent.clientY - startY, bounds.minY, Math.max(bounds.minY, window.innerHeight - size.height - bounds.minY)),
        },
      })
    }
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
  }

  const startFloatingResize = (edge: (typeof FLOATING_RESIZE_CORNERS)[number]["edge"]) => (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const initialSize = sanitizedLayout.floatingSize
    const initialPosition = sanitizedLayout.floatingPosition
    const growsEast = edge.includes("e")
    const growsSouth = edge.includes("s")

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const bounds = getWidgetLayoutBounds()
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      const width = clamp(initialSize.width + (growsEast ? dx : -dx), CHATBOT_WIDGET_MIN_WIDTH, bounds.maxWidth)
      const height = clamp(initialSize.height + (growsSouth ? dy : -dy), CHATBOT_WIDGET_MIN_HEIGHT, bounds.maxHeight)
      const x = growsEast ? initialPosition.x : initialPosition.x + initialSize.width - width
      const y = growsSouth ? initialPosition.y : initialPosition.y + initialSize.height - height
      onFloatingGeometryChange({
        size: { width, height },
        position: {
          x: clamp(x, bounds.minX, Math.max(bounds.minX, window.innerWidth - width - bounds.minX)),
          y: clamp(y, bounds.minY, Math.max(bounds.minY, window.innerHeight - height - bounds.minY)),
        },
      })
    }
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
  }

  const startSidePeekResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const initialWidth = sanitizedLayout.sidePeekWidth

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const bounds = getWidgetLayoutBounds()
      onSidePeekWidthChange(clamp(initialWidth + startX - moveEvent.clientX, CHATBOT_WIDGET_MIN_WIDTH, bounds.maxWidth))
    }
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
  }

  const appendMessage = (message: WidgetMessage) => {
    setMessages((currentMessages) => [...currentMessages, message])
  }

  const markSubmittedUserMessage = (
    createdAt: Date,
    content: string,
    userMessage: { id: string; content: string; createdAt: string },
  ) => {
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.role === "user" &&
        message.content === content &&
        message.createdAt.getTime() === createdAt.getTime()
          ? {
              ...message,
              id: userMessage.id,
              content: userMessage.content,
              createdAt: new Date(userMessage.createdAt),
            }
          : message,
      ),
    )
  }

  useEffect(() => {
    if (!submitting) return

    const timeoutId = window.setTimeout(() => {
      setShowThinkingDelayNotice(true)
    }, thinkingDelayNoticeMs)

    return () => window.clearTimeout(timeoutId)
  }, [submitting])

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
      markSubmittedUserMessage(createdAt, text, payload.userMessage)
      appendMessage({
        id: payload.assistantMessage.id,
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

  const handleEditMessage = async (messageId: string, newText: string) => {
    const targetIndex = messages.findIndex((message) => message.id === messageId && message.role === "user")
    const trimmedText = newText.trim()
    if (targetIndex === -1 || !trimmedText || submitting) return

    setMessages((currentMessages) => currentMessages.slice(0, targetIndex))
    setActiveUi(noUi)
    setShowThinkingDelayNotice(false)
    setSubmitting(true)

    try {
      const payload = await submitChatbotMessage({
        message: trimmedText,
        conversationId,
        editTargetMessageId: messageId,
      })
      setConversationId(payload.conversationId)
      setLastResponseTier(payload.tier)
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: payload.userMessage.id,
          role: payload.userMessage.role,
          content: payload.userMessage.content,
          createdAt: new Date(payload.userMessage.createdAt),
        },
        {
          id: payload.assistantMessage.id,
          role: payload.assistantMessage.role,
          content: payload.assistantMessage.content,
          createdAt: new Date(payload.assistantMessage.createdAt),
        },
      ])
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
      appendMessage({
        role: "system",
        content: buildInquirySummaryMessage(input),
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

  return (
    <section
      ref={shellRef}
      style={shellStyle}
      className={[
        "glass-card glass-card--chat-frost pointer-events-auto relative flex h-[min(560px,calc(100dvh-2rem))] w-full max-w-[384px] animate-in flex-col overflow-hidden rounded-t-[20px] fade-in slide-in-from-bottom-2 duration-300 md:max-w-none md:rounded-[20px]",
        isSidePeek
          ? "md:fixed md:right-0 md:top-0 md:h-dvh md:w-[var(--chatbot-side-peek-width)] md:rounded-none md:rounded-l-[20px] md:border-y-0 md:border-r-0"
          : "md:absolute md:left-[var(--chatbot-widget-x)] md:top-[var(--chatbot-widget-y)] md:h-[var(--chatbot-widget-height)] md:w-[var(--chatbot-widget-width)]",
      ].join(" ")}
      aria-label="AI 相談窓口"
    >
      <div
        className={[
          "flex items-center justify-between gap-3 border-b border-[var(--glass-border)] px-5 py-4",
          isSidePeek ? "" : "md:cursor-grab md:active:cursor-grabbing",
        ].join(" ")}
        onPointerDown={startFloatingMove}
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
          <button
            type="button"
            onClick={() => onModeChange(isSidePeek ? "floating" : "side-peek")}
            className={`glass-btn flex h-9 w-9 shrink-0 items-center justify-center hover:shadow-[0_0_24px_rgba(139,127,255,0.3)] ${FOCUS_RING_CLASS}`}
            aria-label={isSidePeek ? "フローティング表示に切り替え" : "サイドピーク表示に切り替え"}
            aria-pressed={isSidePeek}
          >
            {isSidePeek ? (
              <PanelRightClose className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={onMinimize}
            className={`glass-btn flex h-9 w-9 shrink-0 items-center justify-center hover:shadow-[0_0_24px_rgba(139,127,255,0.3)] ${FOCUS_RING_CLASS}`}
            aria-label="最小化"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      {isSidePeek ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 z-20 hidden h-full w-2 cursor-ew-resize md:block"
          onPointerDown={startSidePeekResize}
        />
      ) : (
        FLOATING_RESIZE_CORNERS.map((corner) => (
          <span
            key={corner.edge}
            aria-hidden="true"
            className={`absolute z-20 hidden md:block ${corner.className}`}
            onPointerDown={startFloatingResize(corner.edge)}
          />
        ))
      )}
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
              key={message.id ?? `${message.role}-${message.createdAt.toISOString()}-${index}`}
              id={message.id}
              role={message.role}
              content={message.content}
              createdAt={message.createdAt}
              editingDisabled={submitting}
              onEdit={handleEditMessage}
            />
          ))}
          {submitting ? <ThinkingIndicator showDelayNotice={showThinkingDelayNotice} /> : null}
        </div>
        <ActiveWidgetUi ui={activeUi} conversationId={conversationId} onSubmit={handleSubmit} onInquirySubmit={handleInquirySubmit} />
      </div>

      <ChatInput onSubmit={handleSubmit} disabled={submitting} />
    </section>
  )
}

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
        defaultDueDate={ui.jobContext.publicReleaseDate}
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
            name: personName,
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
