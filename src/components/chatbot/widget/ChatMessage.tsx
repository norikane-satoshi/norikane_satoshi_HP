"use client"

import { Check, Pencil, X } from "lucide-react"
import { useState } from "react"

import type { ChatbotMessageRole } from "@/lib/chatbot/domain/conversation"
import { stripInternalAssistantMarkup } from "@/lib/chatbot/knowledge"

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

export function ChatMessage({ id, role, content, createdAt, editingDisabled = false, onEdit }: ChatMessageProps) {
  const isUser = role === "user"
  const isSystem = role === "system"
  const canEdit = isUser && Boolean(id) && Boolean(onEdit) && !editingDisabled
  const [isEditing, setIsEditing] = useState(false)
  const [editConfirmPending, setEditConfirmPending] = useState(false)
  const [draft, setDraft] = useState(content)
  const visibleContent = stripInternalAssistantMarkup(content)
  const trimmedDraft = draft.trim()

  const cancelEdit = () => {
    setDraft(content)
    setEditConfirmPending(false)
    setIsEditing(false)
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
      className={[
        "max-w-[88%] px-4 py-3 text-sm leading-relaxed",
        isUser
          ? "glass-bubble--user ml-auto border border-[var(--accent-primary)]/40 text-hp"
          : isSystem
            ? "glass-inset mr-auto text-hp"
            : "glass-bubble--assistant mr-auto text-hp",
        isSystem ? "mx-auto max-w-full text-xs text-hp-muted" : "",
      ].join(" ")}
    >
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold text-hp-muted">
        <span>{roleLabel[role]}</span>
        <span className="flex items-center gap-2">
          {canEdit && !isEditing ? (
            <button
              type="button"
              className="glass-btn inline-flex h-7 items-center gap-1 px-2 text-[11px]"
              onClick={() => {
                setEditConfirmPending(false)
                setIsEditing(true)
              }}
              aria-label="メッセージを編集"
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
              編集
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
            className="glass-input min-h-24 w-full resize-y px-3 py-2 text-sm text-hp"
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
        <p className="whitespace-pre-wrap">{visibleContent}</p>
      )}
    </article>
  )
}
