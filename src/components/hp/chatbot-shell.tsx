"use client"

import { useEffect, useState } from "react"
import { MessageCircle, Minus, Send, Sparkles, X } from "lucide-react"

const CHATBOT_OPEN_EVENT = "hp-chatbot:open"

const quickPrompts = [
  "カラーグレーディングの相談",
  "公開時期から逆算したい",
  "予約まで進めたい",
]

export function ChatbotShell() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handleOpen = () => setOpen(true)

    window.addEventListener(CHATBOT_OPEN_EVENT, handleOpen)
    return () => window.removeEventListener(CHATBOT_OPEN_EVENT, handleOpen)
  }, [])

  return (
    <div className="fixed bottom-5 right-4 z-[60] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-3 md:bottom-8 md:right-8">
      {open ? (
        <section
          className="glass-card w-[min(calc(100vw-2rem),380px)] overflow-hidden"
          aria-label="AIチャットボット相談窓口"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--glass-border)] px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="glass-badge flex h-10 w-10 shrink-0 items-center justify-center"
              >
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-hp">AI相談窓口</p>
                <p className="mt-0.5 text-xs text-hp-muted">案件の輪郭を会話で整理します</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="glass-btn flex h-9 w-9 items-center justify-center"
                aria-label="チャットを最小化"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="glass-btn flex h-9 w-9 items-center justify-center"
                aria-label="チャットを閉じる"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="space-y-4 px-5 py-5">
            <div className="glass-card-sm max-w-[92%] px-4 py-3">
              <p className="text-sm leading-relaxed text-hp">
                ご相談内容をチャットで整理する入口です。AI応答と予約連携は次段階で接続します。
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="glass-badge px-3 py-2 text-xs"
                  disabled
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-[var(--glass-border)] p-4">
            <div className="glass-card-sm flex items-center gap-2 px-3 py-2">
              <input
                className="min-w-0 flex-1 bg-transparent text-sm text-hp outline-none placeholder:text-hp-muted"
                placeholder="相談内容を入力"
                disabled
                aria-label="相談内容"
              />
              <button
                type="button"
                className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center"
                disabled
                aria-label="送信"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glass-btn flex items-center gap-2 px-4 py-3 text-sm font-semibold"
        aria-expanded={open}
        aria-label="AIチャットボット相談窓口を開く"
      >
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        相談する
      </button>
    </div>
  )
}
