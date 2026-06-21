"use client"

import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react"
import { ChevronDown, GripHorizontal, Minus, PanelRightOpen, Sparkles } from "lucide-react"

import type { ChatbotMessageRole } from "@/lib/chatbot/domain/conversation"
import type { JobContext } from "@/lib/chatbot/domain/workflow-estimate"
import type { WidgetDisplayMode } from "./useWidgetState"

import {
  isChatbotOperationError,
  isChatbotRequestCancelledError,
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
import { useConversationScroll } from "./useConversationScroll"

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
const communicationFallbackMessage =
  "通信に失敗しました。自動再試行後も復旧しないため、下のフォームから連絡できます。入力内容はこのまま残っています。"
const inquirySentMessage = "送信しました。担当者からの返信をお待ちください。"
const CHATBOT_SESSION_STORAGE_KEY = "hp-chatbot-session-v1"
const CHATBOT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const thinkingDelayNoticeMs = 6000

const additionalWorkMemoLabels: Record<NonNullable<JobContext["additionalWork"]>[number], string> = {
  retouch: "消し物/レタッチ",
  "skin-retouch": "肌修正",
  other: "その他追加作業",
}

const workSiteMemoLabels: Record<JobContext["workSite"], string> = {
  "satoshi-studio": "のりかね映像設計室",
  "remote-grading": "リモート",
  "on-site": "現地/ポスプロ常駐",
}

type StoredWidgetSession = {
  messages: Array<Omit<WidgetMessage, "createdAt"> & { createdAt: string }>
  clientSessionId?: string
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
  clientSessionId?: string
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
            id: typeof message.id === "string" ? message.id : undefined,
            role: message.role,
            content: message.content,
            createdAt: new Date(message.createdAt),
          }))
      : []

    return {
      messages: messages.length > 0 ? messages : [initialMessage],
      clientSessionId: parsed.clientSessionId,
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

function createClientUserMessageId() {
  const randomId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`
  return `client_msg_${randomId}`
}

function createClientSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`
}

function buildBookingSupplementalNote(jobContext: JobContext, prefillMemo?: string): string {
  return [
    prefillMemo,
    formatProjectLengthMemo(jobContext.projectLengthMinutes),
    formatAdditionalWorkMemo(jobContext.additionalWork),
    formatWorkSiteMemo(jobContext.workSite),
    jobContext.preferredStartDate ? `素材搬入/受け取り時期: ${jobContext.preferredStartDate}` : undefined,
    jobContext.publicReleaseDate ? `納品希望日: ${jobContext.publicReleaseDate}` : undefined,
    ...(jobContext.referenceUrls ?? []),
  ].filter((item): item is string => Boolean(item)).join("\n")
}

function formatProjectLengthMemo(minutes: number | undefined): string | undefined {
  if (minutes === undefined) return undefined
  if (minutes >= 60) {
    const hours = minutes / 60
    return `尺: ${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
  }
  return `尺: ${minutes}分`
}

function formatAdditionalWorkMemo(additionalWork: JobContext["additionalWork"]): string | undefined {
  if (!additionalWork?.length) return undefined
  return `追加作業: ${additionalWork.map((item) => additionalWorkMemoLabels[item]).join(" / ")}`
}

function formatWorkSiteMemo(workSite: JobContext["workSite"]): string | undefined {
  if (!workSite) return undefined
  return `作業場所: ${workSiteMemoLabels[workSite]}`
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
  const [clientSessionId, setClientSessionId] = useState<string>(() => createClientSessionId())
  const [activeUi, setActiveUi] = useState<WidgetUi>(noUi)
  const [submitting, setSubmitting] = useState(false)
  const [showThinkingDelayNotice, setShowThinkingDelayNotice] = useState(false)
  const [lastResponseTier, setLastResponseTier] = useState<ChatbotResponseTier | undefined>(undefined)
  const [hasRestoredSession, setHasRestoredSession] = useState(false)
  const activeRequestControllerRef = useRef<AbortController | null>(null)
  const showLocalTierDebug =
    typeof window !== "undefined" && isLocalChatbotTierDebugHostname(window.location.hostname)
  const conversationContentKey = [
    messages
      .map((message) => `${message.id ?? ""}:${message.role}:${message.createdAt.toISOString()}:${message.content}`)
      .join("|"),
    activeUi.kind,
    submitting ? "submitting" : "idle",
    showThinkingDelayNotice ? "delay" : "normal",
    displayMode,
  ].join("::")
  const {
    containerRef: conversationScrollRef,
    handleScroll: handleConversationScroll,
    shouldShowLatestButton,
    scrollToLatest,
  } = useConversationScroll(conversationContentKey)

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
    if (storedSession.clientSessionId) {
      setClientSessionId(storedSession.clientSessionId)
    }
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
          ...(message.id ? { id: message.id } : {}),
          role: message.role,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
        })),
        clientSessionId,
        conversationId,
        activeUi,
        lastResponseTier,
        expiresAt: new Date(Date.now() + CHATBOT_SESSION_TTL_MS).toISOString(),
      }
      window.localStorage.setItem(CHATBOT_SESSION_STORAGE_KEY, JSON.stringify(stored))
    } catch {
      // localStorage may be unavailable in private or restricted contexts.
    }
  }, [activeUi, clientSessionId, conversationId, hasRestoredSession, lastResponseTier, messages])

  useEffect(() => {
    return () => {
      activeRequestControllerRef.current?.abort()
    }
  }, [])

  const finishRequest = (controller: AbortController) => {
    if (activeRequestControllerRef.current !== controller) return
    activeRequestControllerRef.current = null
    setShowThinkingDelayNotice(false)
    setSubmitting(false)
  }

  const handleStop = () => {
    const controller = activeRequestControllerRef.current
    if (!controller) return
    controller.abort()
    activeRequestControllerRef.current = null
    setShowThinkingDelayNotice(false)
    setSubmitting(false)
  }

  const handleSubmit = async (text: string) => {
    if (submitting) return
    const controller = new AbortController()
    activeRequestControllerRef.current = controller
    const createdAt = new Date()
    const clientUserMessageId = createClientUserMessageId()
    setMessages((currentMessages) => [
      ...currentMessages,
      { id: clientUserMessageId, role: "user", content: text, createdAt },
    ])
    setActiveUi(noUi)
    setShowThinkingDelayNotice(false)
    setSubmitting(true)

    try {
      const payload = await submitChatbotMessage(
        { message: text, conversationId, clientUserMessageId, clientSessionId },
        { signal: controller.signal },
      )
      if (controller.signal.aborted) return
      setConversationId(payload.conversationId)
      setLastResponseTier(payload.tier)
      const submittedUserMessage = payload.userMessage
      if (submittedUserMessage) {
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === clientUserMessageId
              ? {
                  id: submittedUserMessage.id,
                  role: submittedUserMessage.role,
                  content: submittedUserMessage.content,
                  createdAt: new Date(submittedUserMessage.createdAt),
                }
              : message,
          ),
        )
      }
      appendMessage({
        id: payload.assistantMessage.id,
        role: payload.assistantMessage.role,
        content: payload.assistantMessage.content,
        createdAt: new Date(payload.assistantMessage.createdAt),
      })
      setActiveUi(payload.ui)
    } catch (error) {
      if (isChatbotRequestCancelledError(error)) return
      if (isChatbotOperationError(error)) {
        console.warn("[CHATBOT_WIDGET_FAILURE]", {
          event: "chatbot_widget_failure",
          operation: error.operation,
          requestId: error.requestId,
          stage: error.stage,
          status: error.status,
          retryable: error.retryable,
          fallback: error.fallback,
          hasConversationId: Boolean(conversationId),
          activeUiKind: activeUi.kind,
        })
      }
      appendMessage({
        role: "system",
        content: communicationFallbackMessage,
        createdAt: new Date(),
      })
      setActiveUi({ kind: "tier4-inquiry-form" })
    } finally {
      finishRequest(controller)
    }
  }

  const handleEditMessage = async (messageId: string, newText: string) => {
    const targetIndex = messages.findIndex((message) => message.id === messageId && message.role === "user")
    const trimmedText = newText.trim()
    if (targetIndex === -1 || !trimmedText || submitting) return
    const controller = new AbortController()
    activeRequestControllerRef.current = controller
    const optimisticCreatedAt = new Date()

    setMessages((currentMessages) => {
      const currentTargetIndex = currentMessages.findIndex(
        (message) => message.id === messageId && message.role === "user",
      )
      const truncateIndex = currentTargetIndex === -1 ? Math.min(targetIndex, currentMessages.length) : currentTargetIndex
      return [
        ...currentMessages.slice(0, truncateIndex),
        { id: messageId, role: "user", content: trimmedText, createdAt: optimisticCreatedAt },
      ]
    })
    setActiveUi(noUi)
    setShowThinkingDelayNotice(false)
    setSubmitting(true)

    try {
      const payload = await submitChatbotMessage(
        { message: trimmedText, conversationId, editTargetMessageId: messageId, clientSessionId },
        { signal: controller.signal },
      )
      if (controller.signal.aborted) return
      setConversationId(payload.conversationId)
      setLastResponseTier(payload.tier)
      setMessages((currentMessages) => {
        const userMessage = payload.userMessage ?? {
          id: messageId,
          role: "user" as const,
          content: trimmedText,
          createdAt: optimisticCreatedAt.toISOString(),
        }
        const currentTargetIndex = currentMessages.findIndex(
          (message) =>
            message.role === "user" &&
            (message.id === messageId || message.id === userMessage.id),
        )
        const truncateIndex = currentTargetIndex === -1 ? Math.min(targetIndex, currentMessages.length) : currentTargetIndex
        return [
          ...currentMessages.slice(0, truncateIndex),
          {
            id: userMessage.id,
            role: userMessage.role,
            content: userMessage.content,
            createdAt: new Date(userMessage.createdAt),
          },
          {
            id: payload.assistantMessage.id,
            role: payload.assistantMessage.role,
            content: payload.assistantMessage.content,
            createdAt: new Date(payload.assistantMessage.createdAt),
          },
        ]
      })
      setActiveUi(payload.ui)
    } catch (error) {
      if (isChatbotRequestCancelledError(error)) return
      if (isChatbotOperationError(error)) {
        console.warn("[CHATBOT_WIDGET_FAILURE]", {
          event: "chatbot_widget_failure",
          operation: error.operation,
          status: error.status,
          retryable: error.retryable,
          fallback: error.fallback,
          hasConversationId: Boolean(conversationId),
          activeUiKind: activeUi.kind,
        })
      }
      appendMessage({
        role: "system",
        content: communicationFallbackMessage,
        createdAt: new Date(),
      })
      setActiveUi({ kind: "tier4-inquiry-form" })
    } finally {
      finishRequest(controller)
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
        content: communicationFallbackMessage,
        createdAt: new Date(),
      })
      setActiveUi({ kind: "tier4-inquiry-form" })
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

      <div className="relative min-h-0 flex-1">
        <div
          ref={conversationScrollRef}
          onScroll={handleConversationScroll}
          className="h-full space-y-4 overflow-y-auto px-5 py-5"
          aria-label="チャット本文"
        >
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
        {shouldShowLatestButton ? (
          <button
            type="button"
            onClick={scrollToLatest}
            className="glass-badge absolute bottom-4 left-1/2 z-20 inline-flex h-11 w-11 -translate-x-1/2 items-center justify-center border border-[var(--glass-border)] p-0 text-[var(--accent-primary)] shadow-[var(--glass-shadow)] transition hover:shadow-[0_0_24px_rgba(139,127,255,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
            style={{
              background: "rgba(255, 255, 255, 0.42)",
              backdropFilter: "blur(18px) saturate(140%)",
              WebkitBackdropFilter: "blur(18px) saturate(140%)",
            }}
            aria-label="一番下へ移動"
          >
            <ChevronDown className="h-5 w-5" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <ChatInput
        onSubmit={handleSubmit}
        onStop={handleStop}
        disabled={submitting}
        stoppingEnabled={submitting}
      />
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
        allowMultiple={ui.choiceSet.selectionMode === "multiple"}
        onSelect={(selection) => onSubmit(formatChoicePanelSubmission(selection))}
      />
    )
  }

  if (ui.kind === "booking-card") {
    return (
      <ChatbotBookingCard
        conversationId={conversationId}
        candidates={ui.suggestedSlots}
        busyDateKeys={ui.busyDateKeys}
        jobContext={ui.jobContext}
        estimate={ui.jobContext.workflowEstimate}
        defaultProjectTitle={ui.bookingPrefill?.projectTitle}
        defaultContactName={ui.bookingPrefill?.contactName}
        defaultContactEmail={ui.bookingPrefill?.contactEmail}
        defaultCompanyName={ui.bookingPrefill?.companyName}
        defaultDueDate={ui.bookingPrefill?.dueDate ?? ui.jobContext.publicReleaseDate}
        defaultMemo={buildBookingSupplementalNote(ui.jobContext, ui.bookingPrefill?.memo)}
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

  if (ui.kind === "consultation-summary-form") {
    return (
      <InquiryForm
        mode="consultation-summary"
        initialEmail={ui.summary.customerEmail}
        summaryText={ui.summary.summaryText}
        openQuestions={ui.summary.openQuestions}
        onSubmit={(input) =>
          onInquirySubmit({
            ...input,
            freeText: [ui.summary.summaryText, input.freeText].filter(Boolean).join("\n"),
          })
        }
      />
    )
  }

  return null
}

function formatChoicePanelSubmission(selection: {
  selectedLabels: string[]
  selectedIds: string[]
  otherComment?: string
}): string {
  const selectedText = selection.selectedLabels.length > 0 ? selection.selectedLabels.join("、") : selection.selectedIds.join(", ")
  return [`選択: ${selectedText}`, selection.otherComment ? `その他コメント: ${selection.otherComment}` : undefined]
    .filter((line): line is string => Boolean(line))
    .join("\n")
}
