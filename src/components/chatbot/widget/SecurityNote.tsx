"use client"

import { useState } from "react"
import { ChevronDown, ShieldCheck } from "lucide-react"

import {
  CHATBOT_CONVERSATION_CONTENT_CLASS_NAME,
  CHATBOT_CONVERSATION_CONTENT_STYLE,
} from "./conversationTypography"

type SecurityNoteProps = {
  defaultOpen?: boolean
}

export function SecurityNote({ defaultOpen = false }: SecurityNoteProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <section className="glass-inset p-3" aria-label="セキュリティ">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left text-xs font-semibold text-hp"
        style={CHATBOT_CONVERSATION_CONTENT_STYLE}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
          安全に扱います
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <ul
          className={`${CHATBOT_CONVERSATION_CONTENT_CLASS_NAME} mt-3 space-y-1.5 text-xs text-hp-muted`}
          style={CHATBOT_CONVERSATION_CONTENT_STYLE}
        >
          <li>通信と保存データを暗号化して扱います。</li>
          <li>チャットログは 30 日自動削除の対象です。</li>
          <li>他案件情報は参照せず、本人文脈のみを使います。</li>
          <li>カレンダーは busy 時間帯のみ参照します。</li>
          <li>
            詳しくは{" "}
            <a className="underline decoration-dotted underline-offset-4 hover:text-hp" href="/privacy">
              プライバシーポリシー
            </a>
            と{" "}
            <a className="underline decoration-dotted underline-offset-4 hover:text-hp" href="/terms">
              利用規約
            </a>
            をご確認ください。
          </li>
        </ul>
      ) : null}
    </section>
  )
}
