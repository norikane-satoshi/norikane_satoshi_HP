"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import { X } from "lucide-react"
import { HP_MODAL_OVERLAY_Z_INDEX } from "@/components/hp/modal-layer"

export function ProfilePhoto() {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const triggerElement = triggerRef.current

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setOpen(false)
        return
      }

      if (e.key !== "Tab" || !dialogRef.current) {
        return
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1)

      if (focusable.length === 0) {
        e.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
        return
      }

      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()
    document.addEventListener("keydown", handleKey)

    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener("keydown", handleKey)
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus()
      } else {
        triggerElement?.focus()
      }
    }
  }, [open])

  const canUseDocument = typeof document !== "undefined"
  const dialog = open && canUseDocument
    ? createPortal(
        <div
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false)
            }
          }}
          className="fixed inset-0 flex items-center justify-center p-4 md:p-10"
          style={{
            background: "rgba(8, 4, 24, 0.42)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            zIndex: HP_MODAL_OVERLAY_Z_INDEX,
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="プロフィール写真"
            className="relative flex w-full items-center justify-center"
            style={{
              maxWidth: "min(90vw, 90vh)",
              aspectRatio: "1 / 1",
            }}
          >
            <button
              ref={closeButtonRef}
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 z-10 rounded-full border border-white/30 p-2 text-white transition-colors hover:bg-white/10 md:right-4 md:top-4"
              aria-label="閉じる"
            >
              <X className="h-6 w-6" />
            </button>
            <Image
              src="/profile-hero.png"
              alt="則兼 智志"
              fill
              sizes="90vmin"
              className="rounded-2xl object-cover"
              priority
            />
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
        onClick={() => setOpen(true)}
        className="relative block aspect-square w-full max-w-[220px] shrink-0 overflow-hidden rounded-2xl transition-transform hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-4"
        aria-label="プロフィール写真を拡大表示"
      >
        <Image
          src="/profile-hero.png"
          alt="則兼 智志"
          fill
          sizes="220px"
          className="object-cover"
          style={{ objectPosition: "center 30%" }}
        />
      </button>

      {dialog}
    </>
  )
}
