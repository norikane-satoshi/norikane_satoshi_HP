"use client"

import { Fragment, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import { X } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  BIOGRAPHY_CHAPTERS,
  BIOGRAPHY_LEAD,
  type BiographyText,
} from "@/components/hp/biography-data"
import { HP_MODAL_OVERLAY_Z_INDEX } from "@/components/hp/modal-layer"

const FOCUSABLE_SELECTOR = "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])"

function BiographyParagraph({ parts }: { parts: BiographyText[] }) {
  return (
    <p>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <Fragment key={index}>{part}</Fragment>
        ) : (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="hp-text-link"
          >
            {part.text}
          </a>
        ),
      )}
    </p>
  )
}

export function ProfilePhoto() {
  const [open, setOpen] = useState(false)
  const shouldReduceMotion = useReducedMotion()
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
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
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
  const dialog = canUseDocument
    ? createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              data-hp-theme="noir"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.4, ease: "easeOut" }}
              className="hp-bio-overlay fixed inset-0"
              style={{ zIndex: HP_MODAL_OVERLAY_Z_INDEX }}
            >
              {/* プロフィール写真を下敷きにして、その上に生い立ちを重ねる。 */}
              <div aria-hidden="true" className="absolute inset-0">
                <Image
                  src="/hp/profile-portrait.jpg"
                  alt=""
                  fill
                  sizes="100vw"
                  className="hp-bio-backdrop object-cover"
                  priority
                />
                <div className="hp-bio-scrim absolute inset-0" />
              </div>

              <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label="生い立ち"
                className="relative h-full overflow-y-auto overscroll-contain"
              >
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  className="hp-icon-badge fixed right-4 top-4 z-10 bg-[var(--bg-base)]/60 backdrop-blur-sm md:right-8 md:top-8"
                  aria-label="閉じる"
                >
                  <X className="h-5 w-5" />
                </button>

                <motion.article
                  initial={shouldReduceMotion ? false : { y: 24, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={
                    shouldReduceMotion ? { duration: 0 } : { duration: 0.7, delay: 0.1, ease: "easeOut" }
                  }
                  className="mx-auto w-full max-w-[42rem] px-6 pb-[clamp(6rem,12vw,10rem)] pt-[clamp(6rem,14vh,9rem)] text-hp md:px-10"
                >
                  <header className="flex flex-col gap-5">
                    <p className="hp-eyebrow">Biography</p>
                    <h2 className="hp-latin-display text-[clamp(3rem,8vw,5.5rem)]">Satoshi Norikane</h2>
                    <p className="text-[1.0625rem] tracking-[0.08em] text-hp-muted">
                      則兼 智志　{BIOGRAPHY_LEAD}
                    </p>
                  </header>

                  <ol className="mt-[clamp(3.5rem,8vw,6rem)] flex flex-col">
                    {BIOGRAPHY_CHAPTERS.map((chapter) => (
                      <li
                        key={chapter.id}
                        className="hp-rule-top grid gap-6 py-[clamp(2.5rem,6vw,4rem)] md:grid-cols-[7.5rem_minmax(0,1fr)] md:gap-10"
                      >
                        <p className="hp-latin-italic pt-1 text-[1.25rem] text-hp-muted">
                          {chapter.period ?? ""}
                        </p>
                        <div className="flex min-w-0 flex-col gap-5">
                          <h3 className="text-[clamp(1.25rem,2.2vw,1.5rem)] font-medium tracking-[0.08em] break-normal">
                            {chapter.title}
                          </h3>
                          <div className="flex flex-col gap-4 text-[0.98rem] leading-[2.15] tracking-[0.05em] text-hp-muted">
                            {chapter.paragraphs.map((parts, index) => (
                              <BiographyParagraph key={index} parts={parts} />
                            ))}
                          </div>
                          {chapter.image ? (
                            <figure className="mt-3 flex flex-col gap-3">
                              <Image
                                src={chapter.image.src}
                                alt={chapter.image.alt}
                                width={chapter.image.width}
                                height={chapter.image.height}
                                sizes="(max-width: 768px) 88vw, 520px"
                                className="h-auto w-full"
                              />
                              {chapter.image.caption ? (
                                <figcaption className="text-[0.8125rem] tracking-[0.06em] text-hp-muted">
                                  {chapter.image.caption}
                                </figcaption>
                              ) : null}
                            </figure>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                </motion.article>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )
    : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block aspect-[4/5] w-full cursor-pointer overflow-hidden bg-[var(--bg-base)] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hp-color-accent-focus-ring)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--bg-base)]"
        aria-label="生い立ちを読む"
      >
        <Image
          src="/hp/profile-portrait.jpg"
          alt="則兼 智志"
          fill
          sizes="(max-width: 768px) 92vw, 520px"
          className="hp-media-zoom object-cover"
        />
        <span
          aria-hidden="true"
          className="hp-bio-trigger-label absolute inset-x-0 bottom-0 flex items-end justify-between px-5 pb-4 pt-16"
        >
          <span className="hp-latin-italic text-[1.375rem]">Biography</span>
          <span className="hp-arrow-nudge text-[1.125rem]">→</span>
        </span>
      </button>

      {dialog}
    </>
  )
}
