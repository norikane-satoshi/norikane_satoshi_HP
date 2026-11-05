"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowUpRight, X } from "lucide-react"
import { HP_MODAL_OVERLAY_Z_INDEX } from "@/components/hp/modal-layer"
import { PRESS_CATEGORIES, type PressItem, type PressLink } from "@/components/hp/press-data"

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

/** 登壇（マイク）と掲載（紙面）を並べたアイコン。lucide と同じ線の太さで描く。 */
function TalksPressIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M10.5 4.5H4.2a1.2 1.2 0 0 0-1.2 1.2v12.6a1.2 1.2 0 0 0 1.2 1.2h6.3" />
      <path d="M5.8 8.5h3.4M5.8 11.5h3.4M5.8 14.5h2.2" />
      <rect x="14" y="3.5" width="5.2" height="9" rx="2.6" />
      <path d="M12.3 10.6a4.3 4.3 0 0 0 8.6 0" />
      <path d="M16.6 15v4.2M14.4 20.5h4.4" />
    </svg>
  )
}

/** 「2026年10月」「2024年」を並べ替え用の数値（年×100＋月）にする。 */
function getPeriodSortKey(period: string) {
  const match = period.match(/(\d{4})年(?:(\d{1,2})月)?/)
  if (!match) return 0
  return Number(match[1]) * 100 + Number(match[2] ?? 0)
}

/** リンク名が URL そのものなら、ドメイン名だけを見せる。 */
function getLinkText(link: PressLink) {
  if (!/^https?:\/\//.test(link.label)) return link.label
  const host = new URL(link.href).hostname.replace(/^www\./, "")
  return host === "web.archive.org" ? "web.archive.org（保存版）" : host
}

function sortByPeriod(items: readonly PressItem[]) {
  return [...items].sort((a, b) => getPeriodSortKey(b.period) - getPeriodSortKey(a.period))
}

/** 登壇・掲載の一覧。カテゴリごとに新しい順で並べる。 */
function PressList() {
  return (
    <div className="flex flex-col">
      {PRESS_CATEGORIES.map((category) => (
        <section
          key={category.title}
          aria-labelledby={`press-${category.title}`}
          className="flex flex-wrap gap-x-12 gap-y-2 [&+&]:mt-10"
        >
          <h3
            id={`press-${category.title}`}
            className="flex-[1_1_10rem] break-normal pt-6 text-[0.9375rem] font-medium tracking-[0.16em] text-hp-muted"
          >
            {category.title}
          </h3>
          <ul className="min-w-0 flex-[3_1_30rem]">
            {sortByPeriod(category.items).map((item) => (
              <li
                key={`${item.period}-${item.title}`}
                className="hp-rule-bottom grid gap-x-5 gap-y-2 py-6 sm:grid-cols-[minmax(5.25rem,7.5rem)_minmax(0,1fr)]"
                data-press-item
              >
                <p className="pt-1 font-[var(--font-inter)] text-xs tracking-[0.1em] text-hp-muted">
                  {item.period}
                </p>
                <div className="flex min-w-0 flex-col gap-3">
                  <h4 className="break-normal text-[clamp(1rem,1.25vw,1.125rem)] font-medium leading-[1.75] tracking-[0.04em] text-hp">
                    {item.title}
                  </h4>
                  <p className="hp-body text-sm leading-[1.95] text-hp-muted">{item.description}</p>
                  <div className="flex flex-wrap gap-x-6 font-[var(--font-inter)] text-xs tracking-[0.08em]">
                    {item.links.map((link) => (
                      <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hp-plain-link inline-flex min-h-11 items-center gap-1.5"
                        aria-label={`${item.title} ${getLinkText(link)}を新しいタブで開く`}
                      >
                        {getLinkText(link)}
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/**
 * プロフィール欄の「登壇・掲載」ボタンと、その一覧を出すモーダル。
 * URL が #press のときも開く（ナビの「登壇・掲載」から来た場合）。
 */
export function PressDialog() {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === "#press") setOpen(true)
    }
    openFromHash()
    window.addEventListener("hashchange", openFromHash)
    return () => window.removeEventListener("hashchange", openFromHash)
  }, [])

  useEffect(() => {
    if (!open) return

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
      if (event.key !== "Tab" || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) {
        event.preventDefault()
      } else if (event.shiftKey && document.activeElement === first) {
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
      if (window.location.hash === "#press") {
        history.replaceState(null, "", window.location.pathname + window.location.search)
      }
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus()
      } else {
        triggerElement?.focus()
      }
    }
  }, [close, open])

  const dialog =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 flex items-center justify-center bg-[rgba(5,5,5,0.78)] p-4 md:p-8"
            style={{ zIndex: HP_MODAL_OVERLAY_Z_INDEX }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) close()
            }}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="登壇・メディア掲載 / 実績"
              className="press-dialog-surface flex max-h-[min(86vh,820px)] w-full max-w-5xl flex-col overflow-hidden border border-[var(--hp-color-rule)] bg-[var(--bg-base)] p-6 md:p-10"
            >
              <div className="hp-section-heading-row !flex-nowrap !items-start">
                <h2 className="text-[clamp(1.25rem,2vw,1.75rem)] font-medium tracking-[0.08em] text-hp">
                  登壇・メディア掲載 / 実績
                </h2>
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="hp-plain-link flex h-11 w-11 shrink-0 items-center justify-center"
                  aria-label="実績ダイアログを閉じる"
                  onClick={close}
                >
                  <X className="h-5 w-5" strokeWidth={1.25} aria-hidden="true" />
                </button>
              </div>
              <div className="overflow-y-auto pr-1 md:pr-2">
                <PressList />
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
        className="hp-icon-badge px-4"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="登壇・掲載"
        title="登壇・掲載"
        onClick={() => setOpen(true)}
      >
        <TalksPressIcon className="h-5 w-5 shrink-0" />
        <span className="hp-latin-italic ml-1.5 text-[1.0625rem]">Talks &amp; Press</span>
      </button>
      {dialog}
    </>
  )
}
