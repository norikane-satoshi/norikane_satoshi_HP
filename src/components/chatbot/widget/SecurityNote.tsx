"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronDown, ShieldCheck, X } from "lucide-react"

import {
  CHATBOT_CONVERSATION_CONTENT_CLASS_NAME,
  CHATBOT_CONVERSATION_CONTENT_STYLE,
} from "./conversationTypography"
import { HP_MODAL_OVERLAY_Z_INDEX } from "@/components/hp/modal-layer"
import { PrivacyPolicyContent, TermsContent } from "@/components/hp/legal-content"

type SecurityNoteProps = {
  defaultOpen?: boolean
}

type LegalModalKind = "privacy" | "terms"

const focusableSelector =
  "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"

export function SecurityNote({ defaultOpen = false }: SecurityNoteProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [legalModal, setLegalModal] = useState<LegalModalKind | null>(null)

  return (
    <>
      <section className="glass-inset p-3" aria-label="セキュリティ">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left text-xs font-semibold text-hp"
          style={CHATBOT_CONVERSATION_CONTENT_STYLE}
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
        >
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--hp-color-accent)]" aria-hidden="true" />
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
            <li>他のご相談内容は参照せず、このご相談に必要な情報だけを使います。</li>
            <li>カレンダーは空き状況の確認に必要な予定の有無だけを確認します。</li>
            <li>
              詳しくは{" "}
              <button
                type="button"
                className="underline decoration-dotted underline-offset-4 hover:text-hp"
                onClick={() => setLegalModal("privacy")}
              >
                プライバシーポリシー
              </button>
              と{" "}
              <button
                type="button"
                className="underline decoration-dotted underline-offset-4 hover:text-hp"
                onClick={() => setLegalModal("terms")}
              >
                利用規約
              </button>
              をご確認ください。
            </li>
          </ul>
        ) : null}
      </section>
      <LegalModal kind={legalModal} onClose={() => setLegalModal(null)} />
    </>
  )
}

function LegalModal({ kind, onClose }: { kind: LegalModalKind | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!kind) return

    const previousOverflow = document.body.style.overflow
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== "Tab" || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hasAttribute("disabled") && element.tabIndex !== -1,
      )
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
        return
      }

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
      previousActiveElement?.focus()
    }
  }, [kind, onClose])

  if (!kind || typeof document === "undefined") return null

  const title = kind === "privacy" ? "プライバシーポリシー" : "利用規約"
  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-[rgba(8,4,24,0.42)] p-4 md:p-8"
      style={{ zIndex: HP_MODAL_OVERLAY_Z_INDEX }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="glass-card flex max-h-[min(82vh,760px)] w-full max-w-4xl flex-col overflow-hidden p-6 md:p-8 xl:p-10"
      >
        <div className="flex justify-end">
          <button
            ref={closeButtonRef}
            type="button"
            className="glass-btn flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-hp"
            aria-label={`${title}を閉じる`}
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-3 overflow-y-auto pr-1 md:pr-2">
          {kind === "privacy" ? <PrivacyPolicyContent headingLevel="h2" /> : <TermsContent headingLevel="h2" />}
        </div>
      </div>
    </div>,
    document.body,
  )
}
