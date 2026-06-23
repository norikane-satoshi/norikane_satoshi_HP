"use client"

import { Check, Pencil, X } from "lucide-react"
import { Fragment, useRef, useState, type PointerEvent, type ReactNode } from "react"

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
  editingDisabled?: boolean
  onEdit?: (messageId: string, content: string) => void
}

const roleLabel: Record<ChatbotMessageRole, string> = {
  user: "お客さま",
  assistant: "AI アシスタント",
  system: "システム",
}

const LONG_PRESS_EDIT_MS = 600
const LONG_PRESS_MOVE_TOLERANCE_PX = 10

function isMobileLikePointer(pointerType: string) {
  if (pointerType !== "mouse") return true
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia("(pointer: coarse), (max-width: 767px)").matches
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
  editingDisabled = false,
  onEdit,
}: ChatMessageProps) {
  const isUser = role === "user"
  const isSystem = role === "system"
  const canEdit = isUser && Boolean(id) && Boolean(onEdit) && !editingDisabled
  const [isEditing, setIsEditing] = useState(false)
  const [editConfirmPending, setEditConfirmPending] = useState(false)
  const [draft, setDraft] = useState(content)
  const longPressStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    timerId: number
  } | null>(null)
  const trimmedDraft = draft.trim()

  const startEditing = () => {
    setEditConfirmPending(false)
    setDraft(content)
    setIsEditing(true)
  }

  const clearLongPressTimer = () => {
    const longPressState = longPressStateRef.current
    if (!longPressState) return
    window.clearTimeout(longPressState.timerId)
    longPressStateRef.current = null
  }

  const cancelEdit = () => {
    setDraft(content)
    setEditConfirmPending(false)
    setIsEditing(false)
  }

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!canEdit || isEditing || !isMobileLikePointer(event.pointerType)) return
    if (event.button !== 0) return

    clearLongPressTimer()
    const { pointerId, clientX, clientY } = event
    longPressStateRef.current = {
      pointerId,
      startX: clientX,
      startY: clientY,
      timerId: window.setTimeout(() => {
        longPressStateRef.current = null
        startEditing()
      }, LONG_PRESS_EDIT_MS),
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const longPressState = longPressStateRef.current
    if (!longPressState || longPressState.pointerId !== event.pointerId) return

    const movedX = Math.abs(event.clientX - longPressState.startX)
    const movedY = Math.abs(event.clientY - longPressState.startY)
    if (movedX > LONG_PRESS_MOVE_TOLERANCE_PX || movedY > LONG_PRESS_MOVE_TOLERANCE_PX) {
      clearLongPressTimer()
    }
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

  return (
    <article
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearLongPressTimer}
      onPointerCancel={clearLongPressTimer}
      onPointerLeave={clearLongPressTimer}
      className={[
        "group max-w-[88%] px-4 py-3 text-sm leading-relaxed",
        isUser
          ? "glass-flat ml-auto border border-[var(--accent-primary)]/40 text-hp"
          : "glass-inset mr-auto text-hp",
        isSystem ? "mx-auto max-w-full text-xs text-hp-muted" : "",
      ].join(" ")}
    >
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold text-hp-muted">
        <span>{roleLabel[role]}</span>
        <span className="flex items-center gap-2">
          {canEdit && !isEditing ? (
            <button
              type="button"
              className="glass-btn inline-flex h-8 w-8 items-center justify-center opacity-0 transition-opacity duration-150 hover:shadow-[0_0_24px_rgba(139,127,255,0.3)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] group-hover:opacity-100 group-focus-within:opacity-100"
              onClick={startEditing}
              aria-label="メッセージを編集"
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
            </button>
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
          <textarea
            className={`${CHATBOT_CONVERSATION_CONTENT_CLASS_NAME} glass-input min-h-24 w-full resize-y px-3 py-2 text-sm text-hp`}
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
            <div className="flex flex-wrap items-center justify-end gap-2">
              <p className="mr-auto text-xs font-medium text-hp-muted">
                保存すると、これより後のやり取りは削除されます。
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
                className="glass-btn inline-flex h-8 items-center gap-1 px-3 text-xs"
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
