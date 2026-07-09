"use client"

import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { ChevronDown, GripHorizontal, Maximize2, Minimize2, Minus, PanelRightOpen, Sparkles } from "lucide-react"

import type { ChatbotMessageRole } from "@/lib/chatbot/domain/conversation"
import type { JobContext } from "@/lib/chatbot/domain/workflow-estimate"
import type { WidgetDisplayMode } from "./useWidgetState"

import {
  isChatbotOperationError,
  isChatbotRequestCancelledError,
  submitChatbotInquiry,
  submitChatbotMessage,
  type BookingCompletionSummary,
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
import { formatChatbotTierDebugLabel, isLocalChatbotTierDebugLocation } from "./local-tier-debug"
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
  "応答が中断しました。入力内容は残っています。もう一度送信できます。復旧できない場合だけフォームに切り替えます。"
const formFallbackMessage =
  "自動再試行でも応答できませんでした。入力内容は残したまま、必要なら下のフォームから連絡できます。"
const inquirySentMessage = "送信しました。担当者からの返信をお待ちください。"
const CHATBOT_SESSION_STORAGE_KEY = "hp-chatbot-session-v1"
const CHATBOT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CHATBOT_PENDING_REQUEST_TTL_MS = 15 * 60 * 1000
const thinkingDelayNoticeMs = 6000
const SCROLL_BOUNDARY_EPSILON_PX = 1
const SCROLL_INDICATOR_FADE_DELAY_MS = 560
const SCROLL_INDICATOR_DESKTOP_FADE_DELAY_MS = SCROLL_INDICATOR_FADE_DELAY_MS * 2
const SCROLL_INDICATOR_HIT_TARGET_PX = 16
const SCROLL_INDICATOR_MIN_THUMB_PX = 28
const SCROLL_INDICATOR_VERTICAL_INSET_PX = 12

type ScrollIndicatorState = {
  isScrollable: boolean
  isScrolling: boolean
  trackHeight: number
  thumbHeight: number
  thumbTop: number
}

type ScrollThumbDragSession = {
  cleanup: () => void
}

const hiddenScrollIndicatorState: ScrollIndicatorState = {
  isScrollable: false,
  isScrolling: false,
  trackHeight: 0,
  thumbHeight: 0,
  thumbTop: 0,
}

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
  customerDisplayName?: string
  lastResponseTier?: ChatbotResponseTier
  lastResponseDebugModelName?: string
  pendingRequest?: StoredPendingRequest
  recoverableRequest?: StoredPendingRequest
  expiresAt: string
}

type StoredPendingRequest = {
  kind: "message" | "edit"
  message: string
  clientUserMessageId: string
  submittedAt: string
  conversationId?: string
  editTargetMessageId?: string
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

function isStoredPendingRequest(input: unknown): input is StoredPendingRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  const pending = input as Partial<StoredPendingRequest>
  if (pending.kind !== "message" && pending.kind !== "edit") return false
  if (typeof pending.message !== "string" || pending.message.trim().length === 0) return false
  if (typeof pending.clientUserMessageId !== "string" || !pending.clientUserMessageId.startsWith("client_msg_")) {
    return false
  }
  if (pending.kind === "edit" && typeof pending.editTargetMessageId !== "string") return false
  const submittedAt = typeof pending.submittedAt === "string" ? new Date(pending.submittedAt).getTime() : Number.NaN
  return Number.isFinite(submittedAt)
}

function isFreshStoredPendingRequest(input: unknown, now = Date.now()): input is StoredPendingRequest {
  if (!isStoredPendingRequest(input)) return false
  const submittedAt = new Date(input.submittedAt).getTime()
  return now - submittedAt <= CHATBOT_PENDING_REQUEST_TTL_MS
}

function persistWidgetSession(input: Omit<StoredWidgetSession, "expiresAt">) {
  try {
    const stored: StoredWidgetSession = {
      ...input,
      expiresAt: new Date(Date.now() + CHATBOT_SESSION_TTL_MS).toISOString(),
    }
    window.localStorage.setItem(CHATBOT_SESSION_STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // localStorage may be unavailable in private or restricted contexts.
  }
}

function normalizeDisplayName(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeDebugModelName(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function findScrollableElementInsideShell(target: EventTarget, shell: HTMLElement) {
  if (!(target instanceof Element)) return null
  let element: Element | null = target

  while (element && element !== shell) {
    if (element instanceof HTMLElement) {
      const style = window.getComputedStyle(element)
      const hasScrollableOverflowY =
        /(auto|scroll)/.test(style.overflowY) ||
        element.classList.contains("overflow-y-auto") ||
        element.classList.contains("overflow-y-scroll")
      const canScrollY =
        hasScrollableOverflowY && element.scrollHeight > element.clientHeight + SCROLL_BOUNDARY_EPSILON_PX

      if (canScrollY) {
        return element
      }
    }
    element = element.parentElement
  }

  return null
}

function getScrollableElementForDelta(target: EventTarget, shell: HTMLElement, deltaY: number) {
  const scrollableElement = findScrollableElementInsideShell(target, shell)
  if (!scrollableElement || deltaY === 0) return null
  if (deltaY < 0 && scrollableElement.scrollTop > SCROLL_BOUNDARY_EPSILON_PX) return scrollableElement
  if (
    deltaY > 0 &&
    scrollableElement.scrollTop + scrollableElement.clientHeight <
      scrollableElement.scrollHeight - SCROLL_BOUNDARY_EPSILON_PX
  ) {
    return scrollableElement
  }
  return null
}

function scrollParentForTextareaWheel(target: EventTarget, scrollableElement: HTMLElement, deltaY: number) {
  if (!(target instanceof HTMLTextAreaElement) || target === scrollableElement) return false
  const before = scrollableElement.scrollTop
  scrollableElement.scrollTop += deltaY
  return scrollableElement.scrollTop !== before
}

function getFirstTouch(touches: TouchList) {
  return typeof touches.item === "function" ? touches.item(0) : (touches[0] ?? null)
}

function getConversationScrollIndicatorState(container: HTMLElement, isScrolling: boolean): ScrollIndicatorState {
  const { clientHeight, scrollHeight, scrollTop } = container
  if (clientHeight <= 0 || scrollHeight <= clientHeight + SCROLL_BOUNDARY_EPSILON_PX) {
    return hiddenScrollIndicatorState
  }

  const trackHeight = Math.max(0, clientHeight - SCROLL_INDICATOR_VERTICAL_INSET_PX * 2)
  if (trackHeight <= 0) return hiddenScrollIndicatorState

  const rawThumbHeight = (clientHeight / scrollHeight) * trackHeight
  const thumbHeight = Math.min(trackHeight, Math.max(SCROLL_INDICATOR_MIN_THUMB_PX, Math.round(rawThumbHeight)))
  const maxScrollTop = Math.max(1, scrollHeight - clientHeight)
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
  const thumbTop = Math.min(maxThumbTop, Math.max(0, Math.round((scrollTop / maxScrollTop) * maxThumbTop)))

  return {
    isScrollable: true,
    isScrolling,
    trackHeight,
    thumbHeight,
    thumbTop,
  }
}

function getCustomerDisplayNameFromUi(ui: WidgetUi): string | undefined {
  if (ui.kind !== "booking-card") return undefined
  return normalizeDisplayName(ui.completedBooking?.contactName) ?? normalizeDisplayName(ui.bookingPrefill?.contactName)
}

const assistantNameQuestionPattern = /(名前|なんて呼|どう呼|呼べば|あなた.*誰|誰.*あなた|何者)/u

function isAssistantNameIntroduced(messages: WidgetMessage[]): boolean {
  return messages.some((message, index) => {
    if (message.role !== "assistant" || !message.content.includes("のーちゃん")) return false
    return messages.slice(Math.max(0, index - 2), index).some((nearbyMessage) => {
      return nearbyMessage.role === "user" && assistantNameQuestionPattern.test(nearbyMessage.content)
    })
  })
}

function serializeWidgetMessages(messages: WidgetMessage[]): StoredWidgetSession["messages"] {
  return messages.map((message) => ({
    ...(message.id ? { id: message.id } : {}),
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  }))
}

function loadStoredWidgetSession(): {
  messages: WidgetMessage[]
  clientSessionId?: string
  conversationId?: string
  activeUi: WidgetUi
  customerDisplayName?: string
  lastResponseTier?: ChatbotResponseTier
  lastResponseDebugModelName?: string
  pendingRequest?: StoredPendingRequest
  recoverableRequest?: StoredPendingRequest
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

    const pendingRequest = isFreshStoredPendingRequest(parsed.pendingRequest) ? parsed.pendingRequest : undefined
    const recoverableRequest = isStoredPendingRequest(parsed.recoverableRequest)
      ? parsed.recoverableRequest
      : isStoredPendingRequest(parsed.pendingRequest)
        ? parsed.pendingRequest
        : undefined
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
    const restoredMessages = messages.length > 0 ? messages : [initialMessage]
    const messagesWithRecoveryNotice =
      recoverableRequest && !pendingRequest && restoredMessages[restoredMessages.length - 1]?.role !== "system"
        ? [...restoredMessages, { role: "system" as const, content: communicationFallbackMessage, createdAt: new Date() }]
        : restoredMessages

    return {
      messages: messagesWithRecoveryNotice,
      clientSessionId: parsed.clientSessionId,
      conversationId: parsed.conversationId,
      activeUi: pendingRequest || recoverableRequest ? noUi : parsed.activeUi ?? noUi,
      customerDisplayName:
        normalizeDisplayName(parsed.customerDisplayName) ??
        getCustomerDisplayNameFromUi(pendingRequest || recoverableRequest ? noUi : parsed.activeUi ?? noUi),
      lastResponseTier: parsed.lastResponseTier,
      lastResponseDebugModelName: normalizeDebugModelName(parsed.lastResponseDebugModelName),
      pendingRequest,
      recoverableRequest: pendingRequest ? undefined : recoverableRequest,
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
  const [customerDisplayName, setCustomerDisplayName] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  const [showThinkingDelayNotice, setShowThinkingDelayNotice] = useState(false)
  const [lastResponseTier, setLastResponseTier] = useState<ChatbotResponseTier | undefined>(undefined)
  const [lastResponseDebugModelName, setLastResponseDebugModelName] = useState<string | undefined>(undefined)
  const [pendingRequest, setPendingRequest] = useState<StoredPendingRequest | undefined>(undefined)
  const [recoverableRequest, setRecoverableRequest] = useState<StoredPendingRequest | undefined>(undefined)
  const [hasRestoredSession, setHasRestoredSession] = useState(false)
  const activeRequestControllerRef = useRef<AbortController | null>(null)
  const pendingRecoveryStartedRef = useRef(false)
  const restoredPendingRequestRef = useRef<StoredPendingRequest | undefined>(undefined)
  const shellRef = useRef<HTMLElement | null>(null)
  const shellTouchYRef = useRef<number | null>(null)
  const scrollIndicatorFrameRef = useRef<number | null>(null)
  const scrollIndicatorFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollThumbDragSessionRef = useRef<ScrollThumbDragSession | null>(null)
  const [scrollIndicator, setScrollIndicator] = useState<ScrollIndicatorState>(hiddenScrollIndicatorState)
  const [isScrollThumbDragging, setIsScrollThumbDragging] = useState(false)
  const showLocalTierDebug =
    typeof window !== "undefined" && isLocalChatbotTierDebugLocation(window.location.hostname, window.location.port)
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

  const updateScrollIndicator = useCallback(
    (isScrolling: boolean) => {
      const container = conversationScrollRef.current
      if (!container) {
        setScrollIndicator(hiddenScrollIndicatorState)
        return
      }
      setScrollIndicator(getConversationScrollIndicatorState(container, isScrolling))
    },
    [conversationScrollRef],
  )

  const scheduleScrollIndicatorUpdate = useCallback(
    (isScrolling: boolean) => {
      if (scrollIndicatorFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollIndicatorFrameRef.current)
      }
      scrollIndicatorFrameRef.current = window.requestAnimationFrame(() => {
        scrollIndicatorFrameRef.current = null
        updateScrollIndicator(isScrolling)
      })
    },
    [updateScrollIndicator],
  )

  const showScrollIndicatorDuringScroll = useCallback(() => {
    if (scrollIndicatorFadeTimerRef.current !== null) {
      clearTimeout(scrollIndicatorFadeTimerRef.current)
    }
    scheduleScrollIndicatorUpdate(true)
    scrollIndicatorFadeTimerRef.current = setTimeout(() => {
      scrollIndicatorFadeTimerRef.current = null
      scheduleScrollIndicatorUpdate(false)
    }, isDesktopLayout ? SCROLL_INDICATOR_DESKTOP_FADE_DELAY_MS : SCROLL_INDICATOR_FADE_DELAY_MS)
  }, [isDesktopLayout, scheduleScrollIndicatorUpdate])

  const handleConversationScrollWithIndicator = useCallback(
    () => {
      handleConversationScroll()
      showScrollIndicatorDuringScroll()
    },
    [handleConversationScroll, showScrollIndicatorDuringScroll],
  )

  const handleScrollIndicatorPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      const container = conversationScrollRef.current
      if (!container || !scrollIndicator.isScrollable) return

      const maxScrollTop = Math.max(1, container.scrollHeight - container.clientHeight)
      const maxThumbTop = Math.max(0, scrollIndicator.trackHeight - scrollIndicator.thumbHeight)
      if (maxThumbTop <= 0) return

      event.preventDefault()
      event.stopPropagation()
      scrollThumbDragSessionRef.current?.cleanup()

      const captureTarget = event.currentTarget
      const pointerId = event.pointerId
      const startClientY = event.clientY
      const startScrollTop = container.scrollTop
      let hasCleanedUp = false

      const moveConversationToClientY = (clientY: number) => {
        const nextScrollTop = Math.min(
          maxScrollTop,
          Math.max(0, startScrollTop + ((clientY - startClientY) / maxThumbTop) * maxScrollTop),
        )
        container.scrollTop = nextScrollTop
        scheduleScrollIndicatorUpdate(true)
        handleConversationScroll()
      }

      const cleanup = () => {
        if (hasCleanedUp) return
        hasCleanedUp = true
        scrollThumbDragSessionRef.current = null
        setIsScrollThumbDragging(false)
        window.removeEventListener("pointermove", handlePointerMove, true)
        window.removeEventListener("pointerup", handlePointerEnd, true)
        window.removeEventListener("pointercancel", handlePointerEnd, true)
        window.removeEventListener("blur", cleanup)
        document.removeEventListener("visibilitychange", handleVisibilityChange)
        captureTarget.removeEventListener("pointerup", handlePointerEnd, true)
        captureTarget.removeEventListener("pointercancel", handlePointerEnd, true)
        captureTarget.removeEventListener("lostpointercapture", cleanup)
        try {
          if (captureTarget.hasPointerCapture?.(pointerId)) {
            captureTarget.releasePointerCapture(pointerId)
          }
        } catch {
          // The pointer may already have been released by the browser.
        }
        showScrollIndicatorDuringScroll()
      }

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) return
        pointerEvent.preventDefault()
        moveConversationToClientY(pointerEvent.clientY)
      }

      const handlePointerEnd = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId && pointerEvent.pointerType !== "mouse") return
        cleanup()
      }

      const handleVisibilityChange = () => {
        if (document.visibilityState === "hidden") cleanup()
      }

      scrollThumbDragSessionRef.current = { cleanup }
      setIsScrollThumbDragging(true)
      scheduleScrollIndicatorUpdate(true)
      window.addEventListener("pointermove", handlePointerMove, true)
      window.addEventListener("pointerup", handlePointerEnd, true)
      window.addEventListener("pointercancel", handlePointerEnd, true)
      window.addEventListener("blur", cleanup)
      document.addEventListener("visibilitychange", handleVisibilityChange)
      captureTarget.addEventListener("pointerup", handlePointerEnd, true)
      captureTarget.addEventListener("pointercancel", handlePointerEnd, true)
      captureTarget.addEventListener("lostpointercapture", cleanup)
      try {
        captureTarget.setPointerCapture?.(pointerId)
      } catch {
        // Capture can fail if the browser has already ended the pointer.
      }
    },
    [
      conversationScrollRef,
      handleConversationScroll,
      scheduleScrollIndicatorUpdate,
      scrollIndicator.isScrollable,
      scrollIndicator.thumbHeight,
      scrollIndicator.trackHeight,
      showScrollIndicatorDuringScroll,
    ],
  )

  const appendMessage = (message: WidgetMessage) => {
    setMessages((currentMessages) => [...currentMessages, message])
  }

  const rememberCustomerDisplayNameFromUi = (ui: WidgetUi) => {
    const nextCustomerDisplayName = getCustomerDisplayNameFromUi(ui)
    if (nextCustomerDisplayName) {
      setCustomerDisplayName(nextCustomerDisplayName)
    }
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
    setCustomerDisplayName(storedSession.customerDisplayName)
    setLastResponseTier(storedSession.lastResponseTier)
    setLastResponseDebugModelName(storedSession.lastResponseDebugModelName)
    restoredPendingRequestRef.current = storedSession.pendingRequest
    setPendingRequest(storedSession.pendingRequest)
    setRecoverableRequest(storedSession.recoverableRequest)
    setHasRestoredSession(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  useEffect(() => {
    if (!hasRestoredSession) return

    persistWidgetSession({
      messages: serializeWidgetMessages(messages),
      clientSessionId,
      conversationId,
      activeUi,
      ...(customerDisplayName ? { customerDisplayName } : {}),
      lastResponseTier,
      ...(lastResponseDebugModelName ? { lastResponseDebugModelName } : {}),
      ...(pendingRequest ? { pendingRequest } : {}),
      ...(recoverableRequest ? { recoverableRequest } : {}),
    })
  }, [activeUi, clientSessionId, conversationId, customerDisplayName, hasRestoredSession, lastResponseDebugModelName, lastResponseTier, messages, pendingRequest, recoverableRequest])

  const recoverPendingRequest = async (pending: StoredPendingRequest, controller: AbortController) => {
    const recoveryClientUserMessageId = createClientUserMessageId()
    const restoreAgeMs = Date.now() - new Date(pending.submittedAt).getTime()
    console.warn("[CHATBOT_WIDGET_PENDING_RECOVERY]", {
      event: "chatbot_widget_pending_recovery",
      kind: pending.kind,
      restoreAgeMs,
      hasConversationId: Boolean(pending.conversationId ?? conversationId),
      activeUiKind: activeUi.kind,
      displayMode,
    })

    try {
      const payload = await submitChatbotMessage(
        {
          message: pending.message,
          conversationId: pending.conversationId ?? conversationId,
          clientUserMessageId: recoveryClientUserMessageId,
          clientSessionId,
          pendingRequestKind: pending.kind,
          ...(pending.kind === "edit"
            ? { editTargetMessageId: pending.editTargetMessageId }
            : { recoverClientUserMessageId: pending.clientUserMessageId }),
        },
        { signal: controller.signal },
      )
      if (controller.signal.aborted) return
      setConversationId(payload.conversationId)
      setLastResponseTier(payload.tier)
      setLastResponseDebugModelName(payload.debug?.modelName)
      setMessages((currentMessages) => {
        const submittedUserMessage = payload.userMessage ?? {
          id: recoveryClientUserMessageId,
          role: "user" as const,
          content: pending.message,
          createdAt: new Date().toISOString(),
        }
        const targetIds = [pending.clientUserMessageId, pending.editTargetMessageId, submittedUserMessage.id]
          .filter((id): id is string => Boolean(id))
        const targetIndex = currentMessages.findIndex(
          (message) => message.role === "user" && targetIds.includes(message.id ?? ""),
        )
        const userMessage: WidgetMessage = {
          id: submittedUserMessage.id,
          role: submittedUserMessage.role,
          content: submittedUserMessage.content,
          createdAt: new Date(submittedUserMessage.createdAt),
        }
        const assistantMessage: WidgetMessage = {
          id: payload.assistantMessage.id,
          role: payload.assistantMessage.role,
          content: payload.assistantMessage.content,
          createdAt: new Date(payload.assistantMessage.createdAt),
        }
        const nextMessages =
          targetIndex >= 0
            ? [...currentMessages.slice(0, targetIndex), userMessage, assistantMessage]
            : [...currentMessages, userMessage, assistantMessage]
        persistWidgetSession({
          messages: serializeWidgetMessages(nextMessages),
          clientSessionId,
          conversationId: payload.conversationId,
          activeUi: payload.ui,
          lastResponseTier: payload.tier,
          ...(payload.debug?.modelName ? { lastResponseDebugModelName: payload.debug.modelName } : {}),
        })
        return nextMessages
      })
      setActiveUi(payload.ui)
      rememberCustomerDisplayNameFromUi(payload.ui)
      setRecoverableRequest(undefined)
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
          hasConversationId: Boolean(pending.conversationId ?? conversationId),
          activeUiKind: activeUi.kind,
          recoveredPendingRequest: true,
        })
      }
      appendMessage({
        role: "system",
        content: communicationFallbackMessage,
        createdAt: new Date(),
      })
      setActiveUi(noUi)
      setRecoverableRequest(pending)
    } finally {
      finishRequest(controller)
    }
  }

  useEffect(() => {
    const restoredPendingRequest = restoredPendingRequestRef.current
    if (!hasRestoredSession || !restoredPendingRequest || pendingRecoveryStartedRef.current) return
    pendingRecoveryStartedRef.current = true
    restoredPendingRequestRef.current = undefined
    const controller = new AbortController()
    activeRequestControllerRef.current = controller
    setShowThinkingDelayNotice(false)
    setSubmitting(true)
    void recoverPendingRequest(restoredPendingRequest, controller)
    // recoverPendingRequest is intentionally guarded by restoredPendingRequestRef so it runs once per restored snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSessionId, conversationId, displayMode, hasRestoredSession])

  useEffect(() => {
    return () => {
      activeRequestControllerRef.current?.abort()
    }
  }, [])

  const finishRequest = (controller: AbortController) => {
    if (activeRequestControllerRef.current !== controller) return
    activeRequestControllerRef.current = null
    setPendingRequest(undefined)
    setShowThinkingDelayNotice(false)
    setSubmitting(false)
  }

  const handleStop = () => {
    const controller = activeRequestControllerRef.current
    if (!controller) return
    controller.abort()
    activeRequestControllerRef.current = null
    setPendingRequest(undefined)
    setShowThinkingDelayNotice(false)
    setSubmitting(false)
  }

  const handleSubmit = async (text: string) => {
    if (submitting) return
    const controller = new AbortController()
    activeRequestControllerRef.current = controller
    const createdAt = new Date()
    const clientUserMessageId = createClientUserMessageId()
    const nextPendingRequest: StoredPendingRequest = {
      kind: "message",
      message: text,
      clientUserMessageId,
      submittedAt: createdAt.toISOString(),
      ...(conversationId ? { conversationId } : {}),
    }
    setPendingRequest(nextPendingRequest)
    setRecoverableRequest(undefined)
    setMessages((currentMessages) => {
      const nextMessages = [
        ...currentMessages,
        { id: clientUserMessageId, role: "user" as const, content: text, createdAt },
      ]
      persistWidgetSession({
        messages: serializeWidgetMessages(nextMessages),
        clientSessionId,
        conversationId,
        activeUi: noUi,
        lastResponseTier,
        ...(lastResponseDebugModelName ? { lastResponseDebugModelName } : {}),
        pendingRequest: nextPendingRequest,
      })
      return nextMessages
    })
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
      setLastResponseDebugModelName(payload.debug?.modelName)
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
      setMessages((currentMessages) => {
        const nextMessages = [
          ...currentMessages,
          {
            id: payload.assistantMessage.id,
            role: payload.assistantMessage.role,
            content: payload.assistantMessage.content,
            createdAt: new Date(payload.assistantMessage.createdAt),
          },
        ]
        persistWidgetSession({
          messages: serializeWidgetMessages(nextMessages),
          clientSessionId,
          conversationId: payload.conversationId,
          activeUi: payload.ui,
          lastResponseTier: payload.tier,
          ...(payload.debug?.modelName ? { lastResponseDebugModelName: payload.debug.modelName } : {}),
        })
        return nextMessages
      })
      setActiveUi(payload.ui)
      rememberCustomerDisplayNameFromUi(payload.ui)
      setRecoverableRequest(undefined)
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
      setActiveUi(noUi)
      setRecoverableRequest(nextPendingRequest)
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
    const clientUserMessageId = createClientUserMessageId()
    const nextPendingRequest: StoredPendingRequest = {
      kind: "edit",
      message: trimmedText,
      clientUserMessageId,
      editTargetMessageId: messageId,
      submittedAt: optimisticCreatedAt.toISOString(),
      ...(conversationId ? { conversationId } : {}),
    }
    setPendingRequest(nextPendingRequest)
    setRecoverableRequest(undefined)

    setMessages((currentMessages) => {
      const currentTargetIndex = currentMessages.findIndex(
        (message) => message.id === messageId && message.role === "user",
      )
      const truncateIndex = currentTargetIndex === -1 ? Math.min(targetIndex, currentMessages.length) : currentTargetIndex
      const nextMessages = [
        ...currentMessages.slice(0, truncateIndex),
        { id: messageId, role: "user" as const, content: trimmedText, createdAt: optimisticCreatedAt },
      ]
      persistWidgetSession({
        messages: serializeWidgetMessages(nextMessages),
        clientSessionId,
        conversationId,
        activeUi: noUi,
        lastResponseTier,
        ...(lastResponseDebugModelName ? { lastResponseDebugModelName } : {}),
        pendingRequest: nextPendingRequest,
      })
      return nextMessages
    })
    setActiveUi(noUi)
    setShowThinkingDelayNotice(false)
    setSubmitting(true)

    try {
      const payload = await submitChatbotMessage(
        { message: trimmedText, conversationId, editTargetMessageId: messageId, clientUserMessageId, clientSessionId },
        { signal: controller.signal },
      )
      if (controller.signal.aborted) return
      setConversationId(payload.conversationId)
      setLastResponseTier(payload.tier)
      setLastResponseDebugModelName(payload.debug?.modelName)
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
        const nextMessages = [
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
        persistWidgetSession({
          messages: serializeWidgetMessages(nextMessages),
          clientSessionId,
          conversationId: payload.conversationId,
          activeUi: payload.ui,
          lastResponseTier: payload.tier,
          ...(payload.debug?.modelName ? { lastResponseDebugModelName: payload.debug.modelName } : {}),
        })
        return nextMessages
      })
      setActiveUi(payload.ui)
      rememberCustomerDisplayNameFromUi(payload.ui)
      setRecoverableRequest(undefined)
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
      setActiveUi(noUi)
      setRecoverableRequest(nextPendingRequest)
    } finally {
      finishRequest(controller)
    }
  }

  const handleRecoverableRetry = () => {
    if (!recoverableRequest || submitting) return
    setRecoverableRequest(undefined)
    const controller = new AbortController()
    activeRequestControllerRef.current = controller
    setShowThinkingDelayNotice(false)
    setSubmitting(true)
    void recoverPendingRequest(recoverableRequest, controller)
  }

  const handleRecoverableFormFallback = () => {
    if (!recoverableRequest || submitting) return
    setRecoverableRequest(undefined)
    appendMessage({
      role: "system",
      content: formFallbackMessage,
      createdAt: new Date(),
    })
    setActiveUi({ kind: "tier4-inquiry-form" })
  }

  const handleInquirySubmit = async (input: Omit<SubmitInquiryInput, "conversationId">) => {
    const nextCustomerDisplayName = normalizeDisplayName(input.name)
    if (nextCustomerDisplayName) {
      setCustomerDisplayName(nextCustomerDisplayName)
    }
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

  const handleBookingCompleted = (booking: BookingCompletionSummary) => {
    const nextCustomerDisplayName = normalizeDisplayName(booking.contactName)
    if (nextCustomerDisplayName) {
      setCustomerDisplayName(nextCustomerDisplayName)
    }
    setActiveUi((currentUi) => {
      if (currentUi.kind !== "booking-card") return currentUi
      return {
        ...currentUi,
        completedBooking: booking,
      }
    })
  }

  const isSidePeek = isDesktopLayout && displayMode === "side-peek"
  const isFloating = isDesktopLayout && displayMode === "floating"
  const isFullScreen = !isDesktopLayout && displayMode === "full-screen"
  const assistantDisplayName = isAssistantNameIntroduced(messages) ? "のーちゃん" : "AI アシスタント"
  const shellSizeClassName = isDesktopLayout
    ? "h-full w-full max-w-none rounded-[20px]"
    : isFullScreen
      ? "h-[100dvh] w-screen max-w-none rounded-none pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
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

  const stopShellEventPropagation = (event: { stopPropagation: () => void }) => {
    event.stopPropagation()
  }

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return undefined

    const handleWheel = (event: WheelEvent) => {
      event.stopPropagation()
      const scrollableElement = getScrollableElementForDelta(event.target ?? shell, shell, event.deltaY)
      if (scrollableElement) {
        if (scrollParentForTextareaWheel(event.target ?? shell, scrollableElement, event.deltaY)) {
          event.preventDefault()
        }
        return
      }
      if (!scrollableElement) {
        event.preventDefault()
      }
    }
    const handleTouchStart = (event: TouchEvent) => {
      event.stopPropagation()
      shellTouchYRef.current = getFirstTouch(event.touches)?.clientY ?? null
    }
    const handleTouchMove = (event: TouchEvent) => {
      event.stopPropagation()
      const currentY = getFirstTouch(event.touches)?.clientY ?? null
      const previousY = shellTouchYRef.current
      shellTouchYRef.current = currentY
      if (currentY === null || previousY === null) return

      const deltaY = previousY - currentY
      if (!getScrollableElementForDelta(event.target ?? shell, shell, deltaY)) {
        event.preventDefault()
      }
    }
    const handleTouchEnd = (event: TouchEvent) => {
      event.stopPropagation()
      shellTouchYRef.current = null
    }

    shell.addEventListener("wheel", handleWheel, { passive: false })
    shell.addEventListener("touchstart", handleTouchStart, { passive: true })
    shell.addEventListener("touchmove", handleTouchMove, { passive: false })
    shell.addEventListener("touchend", handleTouchEnd, { passive: true })
    shell.addEventListener("touchcancel", handleTouchEnd, { passive: true })
    return () => {
      shell.removeEventListener("wheel", handleWheel)
      shell.removeEventListener("touchstart", handleTouchStart)
      shell.removeEventListener("touchmove", handleTouchMove)
      shell.removeEventListener("touchend", handleTouchEnd)
      shell.removeEventListener("touchcancel", handleTouchEnd)
    }
  }, [])

  useEffect(() => {
    scheduleScrollIndicatorUpdate(false)
    return () => {
      scrollThumbDragSessionRef.current?.cleanup()
      if (scrollIndicatorFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollIndicatorFrameRef.current)
        scrollIndicatorFrameRef.current = null
      }
      if (scrollIndicatorFadeTimerRef.current !== null) {
        clearTimeout(scrollIndicatorFadeTimerRef.current)
        scrollIndicatorFadeTimerRef.current = null
      }
    }
  }, [conversationContentKey, displayMode, scheduleScrollIndicatorUpdate])

  return (
    <section
      ref={shellRef}
      className={`chatbot-widget-shell glass-card glass-card--chat-frost pointer-events-auto relative flex animate-in fade-in slide-in-from-bottom-2 flex-col overflow-hidden duration-300 ${shellSizeClassName}`}
      onPointerDown={stopShellEventPropagation}
      onPointerMove={stopShellEventPropagation}
      onPointerUp={stopShellEventPropagation}
      onPointerCancel={stopShellEventPropagation}
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
            <p className="text-sm font-semibold text-hp">{assistantDisplayName}</p>
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
          ) : (
            <button
              type="button"
              onClick={onToggleDisplayMode}
              className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center hover:shadow-[0_0_24px_rgba(139,127,255,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
              aria-label={isFullScreen ? "通常表示に戻す" : "全画面表示に切り替え"}
            >
              {isFullScreen ? (
                <Minimize2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
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
            Local debug: {formatChatbotTierDebugLabel(lastResponseTier, lastResponseDebugModelName)}
          </p>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={conversationScrollRef}
          onScroll={handleConversationScrollWithIndicator}
          className="chatbot-conversation-scroll h-full space-y-4 overflow-y-auto px-5 py-5"
          style={
            {
              WebkitOverflowScrolling: "touch",
              overscrollBehaviorY: "contain",
              touchAction: "pan-y",
            } as CSSProperties
          }
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
                displayName={
                  message.role === "user"
                    ? customerDisplayName
                    : message.role === "assistant"
                      ? assistantDisplayName
                      : undefined
                }
                editingDisabled={submitting}
                onEdit={handleEditMessage}
              />
            ))}
            {submitting ? <ThinkingIndicator showDelayNotice={showThinkingDelayNotice} /> : null}
          </div>
          {recoverableRequest && !submitting ? (
            <div className="glass-card-sm space-y-3 px-4 py-3 text-xs leading-relaxed text-hp-muted" role="status">
              <p>直前の送信が完了していません。入力内容は保持しています。</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleRecoverableRetry}
                  className="glass-btn px-3 py-2 text-xs font-semibold text-hp"
                >
                  再送する
                </button>
                <button
                  type="button"
                  onClick={handleRecoverableFormFallback}
                  className="glass-btn px-3 py-2 text-xs font-semibold text-hp-muted"
                >
                  フォームに切り替える
                </button>
              </div>
            </div>
          ) : null}
          <ActiveWidgetUi
            ui={activeUi}
            conversationId={conversationId}
            onSubmit={handleSubmit}
            onInquirySubmit={handleInquirySubmit}
            onBookingCompleted={handleBookingCompleted}
          />
        </div>
        {scrollIndicator.isScrollable ? (
          <div
            className="chatbot-scroll-indicator absolute right-1 z-10"
            data-testid="chatbot-scroll-indicator"
            data-scrolling={scrollIndicator.isScrolling ? "true" : "false"}
            aria-hidden="true"
            data-dragging={isScrollThumbDragging ? "true" : "false"}
            onPointerDown={handleScrollIndicatorPointerDown}
            style={{
              top: SCROLL_INDICATOR_VERTICAL_INSET_PX,
              height: scrollIndicator.trackHeight,
              width: SCROLL_INDICATOR_HIT_TARGET_PX,
              pointerEvents: scrollIndicator.isScrolling || isScrollThumbDragging ? "auto" : "none",
            }}
          >
            <div
              className="chatbot-scroll-indicator__thumb"
              data-testid="chatbot-scroll-indicator-thumb"
              style={{
                height: scrollIndicator.thumbHeight,
                top: scrollIndicator.thumbTop,
              }}
            />
          </div>
        ) : null}
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
  onBookingCompleted,
}: {
  ui: WidgetUi
  conversationId?: string
  onSubmit: (text: string) => void
  onInquirySubmit: (input: Omit<SubmitInquiryInput, "conversationId">) => void
  onBookingCompleted: (booking: BookingCompletionSummary) => void
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
        key={bookingCardInstanceKey(conversationId, ui)}
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
        completedBooking={ui.completedBooking}
        onBooked={onBookingCompleted}
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

function bookingCardInstanceKey(conversationId: string | undefined, ui: Extract<WidgetUi, { kind: "booking-card" }>) {
  return [
    conversationId ?? "new",
    ui.completedBooking?.bookingGroupId ?? "draft",
    ui.bookingPrefill?.projectTitle ?? "",
    ui.bookingPrefill?.contactEmail ?? "",
    ui.bookingPrefill?.dueDate ?? "",
    ui.suggestedSlots.map((slot) => `${slot.start}/${slot.end}`).join(","),
  ].join("|")
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
