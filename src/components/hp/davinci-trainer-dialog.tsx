"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ExternalLink, X } from "lucide-react"
import { HP_MODAL_OVERLAY_Z_INDEX } from "@/components/hp/modal-layer"

export const DAVINCI_RESOLVE_TRAINING_URL =
  "https://www.blackmagicdesign.com/jp/products/davinciresolve/training"
export const DAVINCI_RESOLVE_TRAINER_TEXT = "DaVinci Resolve 認定トレーナー"

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

export function DavinciTrainerDialogTrigger() {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const triggerElement = triggerRef.current

    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close()
        return
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1)

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
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus()
      } else {
        triggerElement?.focus()
      }
    }
  }, [close, open])

  const canUseDocument = typeof document !== "undefined"
  const dialog = open && canUseDocument
    ? createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center bg-[rgba(8,4,24,0.42)] p-4 md:p-8"
          style={{
            zIndex: HP_MODAL_OVERLAY_Z_INDEX,
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              close()
            }
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="davinci-trainer-dialog-title"
            className="glass-card flex w-full max-w-xl flex-col p-6 md:p-8"
          >
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">DaVinci Resolve</p>
                <h2
                  id="davinci-trainer-dialog-title"
                  className="hp-heading mt-2 text-2xl font-semibold text-hp md:text-3xl"
                >
                  DaVinci Resolve 認定トレーナー
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="glass-btn flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-hp"
                aria-label="DaVinci Resolve 認定トレーナーダイアログを閉じる"
                onClick={close}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <p className="hp-body mt-6 text-sm text-hp-muted md:text-base">
              Blackmagic Design公式のDaVinci Resolveトレーニングページで、認定トレーナーとして掲載されています。公式ページで確認する場合は、トレーニング形式を「認定トレーナー」、国を「日本」にして「則兼 智志」をご確認ください。
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                className="glass-btn order-2 inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-hp sm:order-1"
                onClick={close}
              >
                閉じる
              </button>
              <a
                href={DAVINCI_RESOLVE_TRAINING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-btn order-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-hp sm:order-2"
              >
                Blackmagic公式ページで確認する
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
              </a>
            </div>
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
        className="inline bg-transparent p-0 text-inherit underline decoration-current decoration-1 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {DAVINCI_RESOLVE_TRAINER_TEXT}
      </button>

      {dialog}
    </>
  )
}
