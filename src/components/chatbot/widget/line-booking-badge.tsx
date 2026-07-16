"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import { SiLine } from "react-icons/si"
import { ExternalLink, X } from "lucide-react"
import { HP_MODAL_OVERLAY_Z_INDEX } from "@/components/hp/modal-layer"

const LINE_FRIEND_URL = "https://line.me/R/ti/p/%40044ucnym"

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

export function LineBookingBadge() {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const triggerElement = triggerRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close()
        return
      }

      if (event.key !== "Tab" || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus()
      } else {
        triggerElement?.focus()
      }
    }
  }, [close, open])

  const dialog = open && typeof document !== "undefined"
    ? createPortal(
        <div
          data-testid="line-qr-overlay"
          className="fixed inset-0 flex items-center justify-center bg-[rgba(8,4,24,0.42)] p-4 md:p-8"
          style={{ zIndex: HP_MODAL_OVERLAY_Z_INDEX }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close()
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="line-qr-dialog-title"
            className="glass-card press-dialog-surface w-full max-w-sm p-6 text-center md:p-8"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 text-left">
                <p className="text-xs font-semibold tracking-[0.16em] text-hp-muted">LINE</p>
                <h2 id="line-qr-dialog-title" className="hp-heading mt-2 text-xl font-semibold text-hp">
                  公式LINEを友だち追加
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="glass-btn flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-hp"
                aria-label="LINE QRコードを閉じる"
                onClick={close}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <Image
              src="/line-friend-qr.png"
              alt="公式LINEを友だち追加するQRコード"
              width={280}
              height={280}
              className="mx-auto mt-6 w-full max-w-[280px] rounded-[var(--hp-radius-sm)] bg-white p-3"
            />
            <p className="hp-body mt-5 text-sm text-hp-muted">
              QRコードを読み取るか、LINEアプリから公式アカウントを開いてください。
            </p>
            <a
              href={LINE_FRIEND_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="glass-btn mt-5 inline-flex min-h-11 items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-hp"
            >
              LINEを開く
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="glass-badge glass-badge--profile-tool pointer-events-auto inline-flex h-12 w-12 items-center justify-center p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
        aria-label="公式LINEを友だち追加"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <SiLine aria-hidden="true" className="h-9 w-9 text-[#06C755]" />
      </button>
      {dialog}
    </>
  )
}
