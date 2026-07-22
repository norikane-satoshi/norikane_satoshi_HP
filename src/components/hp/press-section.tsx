"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ExternalLink, X } from "lucide-react"
import { HP_MODAL_OVERLAY_Z_INDEX } from "@/components/hp/modal-layer"
import { PRESS_CATEGORIES } from "@/components/hp/press-data"
import type { PointerEvent } from "react"
export { PRESS_CATEGORIES } from "@/components/hp/press-data"

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

function SpeakerAtLecternIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.2 6.15a2.65 2.65 0 1 1 5.3 0 2.65 2.65 0 0 1-5.3 0ZM8.75 11.1c.24-2.03 1.97-3.6 4.1-3.6s3.86 1.57 4.1 3.6H8.75Zm-.4 7.5h8.7l.75-7.15H7.6l.75 7.15Zm-1.45 2.15h11.6a.9.9 0 0 0 0-1.8H6.9a.9.9 0 0 0 0 1.8Zm7.46-6.8a.46.46 0 0 1 .64-.14l2.14 1.36a.46.46 0 0 1-.5.78l-2.14-1.36a.46.46 0 0 1-.14-.64Zm.27 1.43a.46.46 0 0 1 .64-.14l1.02.65a.46.46 0 1 1-.49.77l-1.02-.65a.46.46 0 0 1-.15-.63Z"
      />
    </svg>
  )
}

function OpenBookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.2 4.35c2.58.05 4.9.63 6.9 1.72v13.12c-1.86-1.02-4.16-1.56-6.9-1.61V4.35Zm1.75 2.03v9.56c1.22.1 2.35.3 3.38.62V7.15a10.9 10.9 0 0 0-3.38-.77ZM12.9 19.19V6.07c2-1.09 4.32-1.67 6.9-1.72v13.23c-2.74.05-5.04.59-6.9 1.61Zm1.77-12.04v9.41c1.03-.32 2.16-.52 3.38-.62V6.38a10.9 10.9 0 0 0-3.38.77Z"
      />
      <path d="M3.55 19.6c2.85 0 5.24.42 7.18 1.27.83.36 1.71.36 2.54 0 1.94-.85 4.33-1.27 7.18-1.27a.85.85 0 0 0 0-1.7c-3.05 0-5.67.48-7.86 1.44a1.44 1.44 0 0 1-1.18 0C9.22 18.38 6.6 17.9 3.55 17.9a.85.85 0 1 0 0 1.7Z" />
    </svg>
  )
}

function PressDialogContent() {
  return (
    <div className="space-y-8 md:space-y-9">
      {PRESS_CATEGORIES.map((category) => (
        <section key={category.title} aria-labelledby={`press-${category.title}`}>
          <h3
            id={`press-${category.title}`}
            className="hp-compact-text text-base font-semibold text-hp md:text-lg"
          >
            {category.title}
          </h3>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {category.items.map((item) => (
              <article
                key={`${item.period}-${item.title}`}
                className="flex min-h-full flex-col rounded-[12px] border border-white/75 bg-white/70 p-5 md:p-6"
              >
                <p
                  className="font-[var(--font-inter)] text-xs font-semibold"
                  style={{ color: "var(--hp-color-accent)" }}
                >
                  {item.period}
                </p>
                <h4 className="hp-heading mt-2 text-base font-semibold text-hp">
                  {item.title}
                </h4>
                <p className="hp-body mt-3 text-sm text-hp-muted">
                  {item.description}
                </p>
                <div className="mt-auto flex flex-wrap gap-2 pt-5">
                  {item.links.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="glass-badge hp-technical-break inline-flex max-w-full items-center gap-2 px-3 py-1.5 text-xs"
                      aria-label={`${item.title} ${link.label}を新しいタブで開く`}
                    >
                      <span className="truncate">{link.label}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function PressDialog() {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const openDialog = useCallback(() => {
    setOpen(true)
  }, [])

  const openFromPrimaryPointer = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (event.button === 0) {
      openDialog()
    }
  }, [openDialog])

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === "#press") {
        setOpen(true)
      }
    }

    openFromHash()
    window.addEventListener("hashchange", openFromHash)
    return () => window.removeEventListener("hashchange", openFromHash)
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
            aria-label="登壇・メディア掲載 / 実績"
            className="glass-card press-dialog-surface flex max-h-[min(82vh,760px)] w-full max-w-5xl flex-col overflow-hidden p-6 md:p-8 xl:p-10"
          >
            <div className="flex items-start justify-between gap-5">
              <div>
                <h2 className="hp-heading text-2xl font-semibold text-hp md:text-3xl">
                  登壇・メディア掲載 / 実績
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="glass-btn flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-hp"
                aria-label="実績ダイアログを閉じる"
                onClick={close}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-7 overflow-y-auto pr-1 md:pr-2">
              <PressDialogContent />
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
        className="glass-btn glass-btn--profile-social flex h-10 w-[4.5rem] items-center justify-center gap-1 px-3 text-hp"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="実績"
        title="実績"
        onPointerUp={openFromPrimaryPointer}
        onClick={openDialog}
      >
        <SpeakerAtLecternIcon className="h-[22px] w-[22px] shrink-0" />
        <OpenBookIcon className="h-5 w-5 shrink-0" />
      </button>

      {dialog}
    </>
  )
}
