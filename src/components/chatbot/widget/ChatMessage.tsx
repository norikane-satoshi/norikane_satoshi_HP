"use client"

import { Check, Pencil, X } from "lucide-react"
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react"

import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea"
import type { ChatbotMessageRole } from "@/lib/chatbot/domain/conversation"
import {
  CHATBOT_CONVERSATION_CONTENT_CLASS_NAME,
  CHATBOT_CONVERSATION_CONTENT_STYLE,
} from "./conversationTypography"

type ChatMessageProps = {
  id?: string
  role: ChatbotMessageRole
  content: string
  createdAt?: Date
  displayName?: string | null
  editingDisabled?: boolean
  onEdit?: (messageId: string, content: string) => void
}

const roleLabel: Record<ChatbotMessageRole, string> = {
  user: "",
  assistant: "AI アシスタント",
  system: "システム",
}

const LONG_PRESS_EDIT_MS = 600
const LONG_PRESS_MOVE_TOLERANCE_PX = 10
const LONG_PRESS_STATIONARY_TOLERANCE_PX = 3
const LONG_PRESS_VIBRATION_MS = 10
const TOUCH_RELEASE_RIPPLE_MS = 420
const TOUCH_CANCEL_FALLBACK_MS = 900
const TOUCH_EDIT_HINT_LABEL = "長押しして編集"
const EDIT_TRUNCATION_WARNING = "下の会話は削除されます"
const PENDING_TOUCH_IDENTIFIER = -1
const CHATBOT_MESSAGE_EDITING_STARTED_EVENT = "chatbot-message-editing-started"

type TouchFeedbackState = "idle" | "active" | "release"

type LongPressState = {
  pointerId?: number
  touchIdentifier?: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  timerId: number
}

type TouchPoint = {
  identifier: number
  clientX: number
  clientY: number
}

type TouchCollection = {
  length: number
  item?: (index: number) => TouchPoint | null
  [index: number]: TouchPoint | undefined
}

type LongPressOwner = {
  messageId: string
  pointerId?: number
  touchIdentifier?: number
}

type ChatbotMessageEditingStartedEventDetail = {
  messageId: string
}

let activeLongPressOwner: LongPressOwner | null = null

function claimLongPressOwner(messageId: string, owner: Omit<LongPressOwner, "messageId">) {
  if (activeLongPressOwner && activeLongPressOwner.messageId !== messageId) return false
  activeLongPressOwner = {
    ...activeLongPressOwner,
    ...owner,
    messageId,
  }
  return true
}

function isLongPressOwner(messageId: string) {
  return activeLongPressOwner?.messageId === messageId
}

function releaseLongPressOwner(messageId: string) {
  if (isLongPressOwner(messageId)) {
    activeLongPressOwner = null
  }
}

function isMobileLikePointer(pointerType: string) {
  if (pointerType !== "mouse") return true
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia("(pointer: coarse), (max-width: 767px)").matches
}

function getTrackedTouch(touches: TouchCollection, preferredIdentifier: number | null): TouchPoint | null {
  const getTouchAt = (index: number) =>
    typeof touches.item === "function" ? touches.item(index) : (touches[index] ?? null)

  if (preferredIdentifier !== null && preferredIdentifier !== PENDING_TOUCH_IDENTIFIER) {
    for (let index = 0; index < touches.length; index += 1) {
      const touch = getTouchAt(index)
      if (touch && touch.identifier === preferredIdentifier) {
        return { identifier: touch.identifier, clientX: touch.clientX, clientY: touch.clientY }
      }
    }
    return null
  }

  const touch = getTouchAt(0)
  return touch ? { identifier: touch.identifier, clientX: touch.clientX, clientY: touch.clientY } : null
}

function renderAssistantMarkdown(content: string): ReactNode {
  const pattern = /(\*\*|__)([\s\S]+?)\1/g
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content))) {
    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index))
    }
    nodes.push(
      <strong key={`${match.index}-${pattern.lastIndex}`} className="font-semibold">
        {match[2]}
      </strong>,
    )
    lastIndex = pattern.lastIndex
  }

  if (nodes.length === 0) return content
  if (lastIndex < content.length) nodes.push(content.slice(lastIndex))

  return nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>)
}

export function ChatMessage({
  id,
  role,
  content,
  createdAt,
  displayName,
  editingDisabled = false,
  onEdit,
}: ChatMessageProps) {
  const isUser = role === "user"
  const isSystem = role === "system"
  const canEdit = isUser && Boolean(id) && Boolean(onEdit) && !editingDisabled
  const [isEditing, setIsEditing] = useState(false)
  const [editConfirmPending, setEditConfirmPending] = useState(false)
  const [showTouchEditAffordance, setShowTouchEditAffordance] = useState(false)
  const [touchFeedbackState, setTouchFeedbackState] = useState<TouchFeedbackState>("idle")
  const [draft, setDraft] = useState(content)
  const longPressStateRef = useRef<LongPressState | null>(null)
  const activeTouchIdentifierRef = useRef<number | null>(null)
  const activeTouchFeedbackRef = useRef(false)
  const touchReleaseTimerRef = useRef<number | null>(null)
  const touchCancelFallbackTimerRef = useRef<number | null>(null)
  const endTouchFeedbackRef = useRef<() => void>(() => {})
  const scheduleTouchCancelFallbackRef = useRef<() => void>(() => {})
  const continueTouchLongPressRef = useRef<(point: TouchPoint) => void>(() => {})
  const articleRef = useRef<HTMLElement | null>(null)
  const trimmedDraft = draft.trim()
  const normalizedDisplayName = displayName?.trim()
  const resolvedRoleLabel = normalizedDisplayName || roleLabel[role]

  const hideMobileEditHint = () => {
    setShowTouchEditAffordance(false)
  }

  const clearTouchReleaseTimer = useCallback(() => {
    if (touchReleaseTimerRef.current === null) return
    window.clearTimeout(touchReleaseTimerRef.current)
    touchReleaseTimerRef.current = null
  }, [])

  const clearTouchCancelFallbackTimer = useCallback(() => {
    if (touchCancelFallbackTimerRef.current === null) return
    window.clearTimeout(touchCancelFallbackTimerRef.current)
    touchCancelFallbackTimerRef.current = null
  }, [])

  const showActiveTouchFeedback = useCallback(() => {
    clearTouchReleaseTimer()
    clearTouchCancelFallbackTimer()
    activeTouchFeedbackRef.current = true
    setTouchFeedbackState("active")
    setShowTouchEditAffordance(true)
  }, [clearTouchCancelFallbackTimer, clearTouchReleaseTimer])

  const endTouchFeedback = useCallback(() => {
    if (!activeTouchFeedbackRef.current) return
    activeTouchFeedbackRef.current = false
    clearTouchCancelFallbackTimer()
    setShowTouchEditAffordance(false)
    setTouchFeedbackState((currentState) => (currentState === "active" ? "release" : currentState))
    clearTouchReleaseTimer()
    touchReleaseTimerRef.current = window.setTimeout(() => {
      touchReleaseTimerRef.current = null
      setTouchFeedbackState("idle")
    }, TOUCH_RELEASE_RIPPLE_MS)
  }, [clearTouchCancelFallbackTimer, clearTouchReleaseTimer])

  const scheduleTouchCancelFallback = useCallback(() => {
    if (!activeTouchFeedbackRef.current) return
    clearTouchCancelFallbackTimer()
    touchCancelFallbackTimerRef.current = window.setTimeout(() => {
      touchCancelFallbackTimerRef.current = null
      endTouchFeedbackRef.current()
    }, TOUCH_CANCEL_FALLBACK_MS)
  }, [clearTouchCancelFallbackTimer])

  const vibrateOnLongPress = useCallback(() => {
    if (typeof navigator === "undefined") return
    const vibrate = navigator.vibrate
    if (typeof vibrate === "function") {
      vibrate.call(navigator, [LONG_PRESS_VIBRATION_MS])
    }
  }, [])

  const clearTextSelection = useCallback(() => {
    const selection = window.getSelection?.()
    selection?.removeAllRanges()
  }, [])

  const startEditing = useCallback(() => {
    if (!id) return
    releaseLongPressOwner(id)
    activeTouchFeedbackRef.current = false
    activeTouchIdentifierRef.current = null
    hideMobileEditHint()
    clearTouchReleaseTimer()
    clearTouchCancelFallbackTimer()
    clearTextSelection()
    setTouchFeedbackState("idle")
    setEditConfirmPending(false)
    setDraft(content)
    setIsEditing(true)
    window.dispatchEvent(
      new CustomEvent<ChatbotMessageEditingStartedEventDetail>(CHATBOT_MESSAGE_EDITING_STARTED_EVENT, {
        detail: { messageId: id },
      }),
    )
  }, [clearTextSelection, clearTouchCancelFallbackTimer, clearTouchReleaseTimer, content, id])

  const armLongPressTimer = useCallback((longPressState: LongPressState, startX: number, startY: number) => {
    window.clearTimeout(longPressState.timerId)
    longPressState.startX = startX
    longPressState.startY = startY
    longPressState.timerId = window.setTimeout(() => {
      if (longPressStateRef.current !== longPressState) return
      longPressStateRef.current = null
      vibrateOnLongPress()
      startEditing()
    }, LONG_PRESS_EDIT_MS)
  }, [startEditing, vibrateOnLongPress])

  const clearLongPressTimer = useCallback(() => {
    const longPressState = longPressStateRef.current
    if (!longPressState) return
    window.clearTimeout(longPressState.timerId)
    longPressStateRef.current = null
  }, [])

  const updateLongPressPosition = useCallback((longPressState: LongPressState, clientX: number, clientY: number) => {
    const movedSinceLastX = Math.abs(clientX - longPressState.lastX)
    const movedSinceLastY = Math.abs(clientY - longPressState.lastY)
    const movedFromHoldStartX = Math.abs(clientX - longPressState.startX)
    const movedFromHoldStartY = Math.abs(clientY - longPressState.startY)
    longPressState.lastX = clientX
    longPressState.lastY = clientY

    const isActivelyMoving =
      movedSinceLastX > LONG_PRESS_STATIONARY_TOLERANCE_PX ||
      movedSinceLastY > LONG_PRESS_STATIONARY_TOLERANCE_PX ||
      movedFromHoldStartX > LONG_PRESS_MOVE_TOLERANCE_PX ||
      movedFromHoldStartY > LONG_PRESS_MOVE_TOLERANCE_PX

    if (isActivelyMoving) {
      armLongPressTimer(longPressState, clientX, clientY)
    }
  }, [armLongPressTimer])

  const continueTouchLongPress = useCallback((point: TouchPoint) => {
    if (!canEdit || !id || isEditing || !isLongPressOwner(id)) return
    if (!claimLongPressOwner(id, { touchIdentifier: point.identifier })) return
    activeTouchIdentifierRef.current = point.identifier
    clearTouchCancelFallbackTimer()
    if (!activeTouchFeedbackRef.current) {
      showActiveTouchFeedback()
    }

    const longPressState = longPressStateRef.current
    if (!longPressState || longPressState.touchIdentifier !== point.identifier) {
      const nextLongPressState: LongPressState = {
        touchIdentifier: point.identifier,
        startX: point.clientX,
        startY: point.clientY,
        lastX: point.clientX,
        lastY: point.clientY,
        timerId: 0,
      }
      longPressStateRef.current = nextLongPressState
      armLongPressTimer(nextLongPressState, point.clientX, point.clientY)
      return
    }

    updateLongPressPosition(longPressState, point.clientX, point.clientY)
  }, [armLongPressTimer, canEdit, clearTouchCancelFallbackTimer, id, isEditing, showActiveTouchFeedback, updateLongPressPosition])

  const finishTouchSession = () => {
    if (id) releaseLongPressOwner(id)
    activeTouchIdentifierRef.current = null
    clearLongPressTimer()
    endTouchFeedback()
  }

  const cancelEdit = useCallback(() => {
    setDraft(content)
    setEditConfirmPending(false)
    setIsEditing(false)
  }, [content])

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!canEdit || !id || isEditing || !isMobileLikePointer(event.pointerType)) return
    if (event.button !== 0) return
    if (activeTouchIdentifierRef.current !== null && activeTouchIdentifierRef.current !== PENDING_TOUCH_IDENTIFIER) return
    if (!claimLongPressOwner(id, { pointerId: event.pointerId })) return

    hideMobileEditHint()
    clearLongPressTimer()
    activeTouchIdentifierRef.current ??= PENDING_TOUCH_IDENTIFIER
    showActiveTouchFeedback()
    const { pointerId, clientX, clientY } = event
    const longPressState: LongPressState = {
      pointerId,
      startX: clientX,
      startY: clientY,
      lastX: clientX,
      lastY: clientY,
      timerId: 0,
    }
    longPressStateRef.current = longPressState
    armLongPressTimer(longPressState, clientX, clientY)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!id || !isLongPressOwner(id)) return
    const longPressState = longPressStateRef.current
    if (!longPressState || longPressState.pointerId !== event.pointerId) return
    updateLongPressPosition(longPressState, event.clientX, event.clientY)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!id || !isLongPressOwner(id)) return
    const longPressState = longPressStateRef.current
    if (longPressState && longPressState.pointerId === event.pointerId) {
      clearLongPressTimer()
    }

    if (canEdit && isMobileLikePointer(event.pointerType)) {
      releaseLongPressOwner(id)
      activeTouchIdentifierRef.current = null
      endTouchFeedback()
    }
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    if (!id || !isLongPressOwner(id)) return
    clearLongPressTimer()
    if (canEdit && isMobileLikePointer(event.pointerType)) {
      scheduleTouchCancelFallback()
    }
  }

  const handlePointerLeave = (event: ReactPointerEvent<HTMLElement>) => {
    if (!id || !isLongPressOwner(id)) return
    clearLongPressTimer()
    if (canEdit && isMobileLikePointer(event.pointerType)) {
      scheduleTouchCancelFallback()
    }
  }

  const handleTouchStart = (event: ReactTouchEvent<HTMLElement>) => {
    if (!canEdit || !id || isEditing) return
    const touch = getTrackedTouch(event.changedTouches, null)
    if (!touch) return
    if (!claimLongPressOwner(id, { touchIdentifier: touch.identifier })) return

    hideMobileEditHint()
    clearLongPressTimer()
    activeTouchIdentifierRef.current = touch.identifier
    showActiveTouchFeedback()
    const longPressState: LongPressState = {
      touchIdentifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      timerId: 0,
    }
    longPressStateRef.current = longPressState
    armLongPressTimer(longPressState, touch.clientX, touch.clientY)
  }

  const handleTouchMove = (event: ReactTouchEvent<HTMLElement>) => {
    if (!id || !isLongPressOwner(id)) return
    const touch = getTrackedTouch(event.touches, activeTouchIdentifierRef.current)
    if (!touch) return
    continueTouchLongPress(touch)
  }

  const handleTouchEnd = () => {
    finishTouchSession()
  }

  const handleTouchCancel = () => {
    if (id) releaseLongPressOwner(id)
    activeTouchIdentifierRef.current = null
    clearLongPressTimer()
    scheduleTouchCancelFallback()
  }

  const requestSaveEdit = () => {
    if (!id || !trimmedDraft || trimmedDraft === content.trim()) {
      cancelEdit()
      return
    }
    setEditConfirmPending(true)
  }

  const confirmSaveEdit = () => {
    if (!id || !trimmedDraft || trimmedDraft === content.trim()) {
      cancelEdit()
      return
    }
    onEdit?.(id, trimmedDraft)
    setEditConfirmPending(false)
    setIsEditing(false)
  }

  useEffect(() => {
    endTouchFeedbackRef.current = endTouchFeedback
    scheduleTouchCancelFallbackRef.current = scheduleTouchCancelFallback
  }, [endTouchFeedback, scheduleTouchCancelFallback])

  useEffect(() => {
    continueTouchLongPressRef.current = continueTouchLongPress
  }, [continueTouchLongPress])

  useEffect(() => {
    const handleEditingStarted = (event: Event) => {
      const nextMessageId = (event as CustomEvent<ChatbotMessageEditingStartedEventDetail>).detail?.messageId
      if (!id || !nextMessageId || nextMessageId === id) return

      releaseLongPressOwner(id)
      activeTouchFeedbackRef.current = false
      activeTouchIdentifierRef.current = null
      clearLongPressTimer()
      clearTouchReleaseTimer()
      clearTouchCancelFallbackTimer()
      hideMobileEditHint()
      setTouchFeedbackState("idle")
      setEditConfirmPending(false)
      setDraft(content)
      setIsEditing(false)
    }

    window.addEventListener(CHATBOT_MESSAGE_EDITING_STARTED_EVENT, handleEditingStarted)
    return () => window.removeEventListener(CHATBOT_MESSAGE_EDITING_STARTED_EVENT, handleEditingStarted)
  }, [clearLongPressTimer, clearTouchCancelFallbackTimer, clearTouchReleaseTimer, content, id])

  useEffect(() => {
    if (!isEditing) return undefined

    const handleOutsideEditPointer = (event: PointerEvent | MouseEvent | TouchEvent) => {
      const article = articleRef.current
      const target = event.target
      if (article && target instanceof Node && article.contains(target)) return
      cancelEdit()
    }

    document.addEventListener("pointerdown", handleOutsideEditPointer, true)
    document.addEventListener("mousedown", handleOutsideEditPointer, true)
    document.addEventListener("touchstart", handleOutsideEditPointer, { capture: true, passive: true })
    return () => {
      document.removeEventListener("pointerdown", handleOutsideEditPointer, true)
      document.removeEventListener("mousedown", handleOutsideEditPointer, true)
      document.removeEventListener("touchstart", handleOutsideEditPointer, true)
    }
  }, [cancelEdit, isEditing])

  useEffect(() => {
    const handleWindowTouchEnd = () => {
      if (!id || !isLongPressOwner(id)) return
      releaseLongPressOwner(id)
      activeTouchIdentifierRef.current = null
      clearLongPressTimer()
      endTouchFeedbackRef.current()
    }
    const handleWindowTouchCancel = () => {
      if (!id || !isLongPressOwner(id)) return
      releaseLongPressOwner(id)
      activeTouchIdentifierRef.current = null
      clearLongPressTimer()
      scheduleTouchCancelFallbackRef.current()
    }
    const handleWindowTouchMove = (event: TouchEvent) => {
      if (!id || !isLongPressOwner(id)) return
      const touch = getTrackedTouch(event.touches, activeTouchIdentifierRef.current)
      if (!touch) return
      continueTouchLongPressRef.current(touch)
    }
    const handleWindowPointerUp = (event: PointerEvent) => {
      if (!id || !isLongPressOwner(id)) return
      if (isMobileLikePointer(event.pointerType)) {
        releaseLongPressOwner(id)
        activeTouchIdentifierRef.current = null
        clearLongPressTimer()
        endTouchFeedbackRef.current()
      }
    }

    window.addEventListener("touchmove", handleWindowTouchMove, { passive: true, capture: true })
    window.addEventListener("touchend", handleWindowTouchEnd, { passive: true, capture: true })
    window.addEventListener("touchcancel", handleWindowTouchCancel, { passive: true, capture: true })
    window.addEventListener("pointerup", handleWindowPointerUp, true)

    return () => {
      if (id) releaseLongPressOwner(id)
      clearLongPressTimer()
      clearTouchReleaseTimer()
      clearTouchCancelFallbackTimer()
      window.removeEventListener("touchmove", handleWindowTouchMove, true)
      window.removeEventListener("touchend", handleWindowTouchEnd, true)
      window.removeEventListener("touchcancel", handleWindowTouchCancel, true)
      window.removeEventListener("pointerup", handleWindowPointerUp, true)
    }
  }, [clearLongPressTimer, clearTouchCancelFallbackTimer, clearTouchReleaseTimer, id])

  return (
    <article
      ref={articleRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      data-chatbot-user-message={isUser ? "true" : undefined}
      data-chatbot-touch-state={isUser && touchFeedbackState !== "idle" ? touchFeedbackState : undefined}
      className={[
        "group max-w-[88%] px-4 py-3 text-sm leading-relaxed",
        canEdit && !isEditing ? "chatbot-message-no-select" : "",
        isUser
          ? `${touchFeedbackState !== "idle" ? "chatbot-message-liquid " : ""}glass-flat ml-auto border border-[var(--accent-primary)]/40 text-hp`
          : "glass-inset mr-auto text-hp",
        isSystem ? "mx-auto max-w-full text-xs text-hp-muted" : "",
      ].join(" ")}
    >
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold text-hp-muted">
        {resolvedRoleLabel ? <span>{resolvedRoleLabel}</span> : <span aria-hidden="true" />}
        <span className="flex items-center gap-2">
          {canEdit && !isEditing ? (
            <button
              type="button"
              className="glass-btn inline-flex h-8 w-8 items-center justify-center opacity-0 transition-opacity duration-150 hover:shadow-[0_0_24px_color-mix(in_srgb,var(--hp-color-accent)_30%,transparent)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] group-hover:opacity-100 group-focus-within:opacity-100"
              onClick={startEditing}
              aria-label="メッセージを編集"
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : null}
          {!isEditing && showTouchEditAffordance ? (
            <span className="whitespace-nowrap text-[11px] font-medium text-hp-muted" role="status">
              {TOUCH_EDIT_HINT_LABEL}
            </span>
          ) : null}
          {createdAt ? (
            <time dateTime={createdAt.toISOString()}>
              {createdAt.toLocaleTimeString("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Tokyo",
              })}
            </time>
          ) : null}
        </span>
      </div>
      {isEditing ? (
        <div className="space-y-2">
          <AutoResizeTextarea
            className={`${CHATBOT_CONVERSATION_CONTENT_CLASS_NAME} glass-input min-h-24 w-full px-3 py-2 text-sm text-hp`}
            style={CHATBOT_CONVERSATION_CONTENT_STYLE}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setEditConfirmPending(false)
            }}
            aria-label="編集内容"
            disabled={editingDisabled}
          />
          {editConfirmPending ? (
            <div
              className="flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-red-300 bg-red-50/70 px-3 py-2"
              data-edit-confirm-pending="true"
            >
              <p className="mr-auto text-xs font-semibold text-red-600">
                {EDIT_TRUNCATION_WARNING}
              </p>
              <button
                type="button"
                className="glass-btn inline-flex h-8 items-center gap-1 px-3 text-xs"
                onClick={() => setEditConfirmPending(false)}
                disabled={editingDisabled}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                キャンセル
              </button>
              <button
                type="button"
                className="glass-btn inline-flex h-8 items-center gap-1 border-red-300 px-3 text-xs font-semibold text-red-700 hover:shadow-[0_0_24px_rgba(239,68,68,0.24)] focus-visible:outline-red-400"
                onClick={confirmSaveEdit}
                disabled={editingDisabled || !trimmedDraft || trimmedDraft === content.trim()}
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                OK
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="glass-btn inline-flex h-8 items-center gap-1 px-3 text-xs"
                onClick={cancelEdit}
                disabled={editingDisabled}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                キャンセル
              </button>
              <button
                type="button"
                className="glass-btn inline-flex h-8 items-center gap-1 px-3 text-xs"
                onClick={requestSaveEdit}
                disabled={editingDisabled || !trimmedDraft || trimmedDraft === content.trim()}
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                保存
              </button>
            </div>
          )}
        </div>
      ) : (
        <p
          className={`${CHATBOT_CONVERSATION_CONTENT_CLASS_NAME} whitespace-pre-wrap`}
          style={CHATBOT_CONVERSATION_CONTENT_STYLE}
        >
          {role === "assistant" ? renderAssistantMarkdown(content) : content}
        </p>
      )}
    </article>
  )
}
