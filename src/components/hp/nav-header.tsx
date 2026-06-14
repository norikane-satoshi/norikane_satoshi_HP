"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Menu, X } from "lucide-react"
import { SITE_BRAND_NAME } from "@/lib/site-brand"

const navItems = [
  { type: "link" as const, href: "/", label: "ホーム" },
  { type: "link" as const, href: "/#profile", label: "プロフィール" },
  { type: "link" as const, href: "/#philosophy", label: "ノート" },
  { type: "chatbot" as const, label: "お問い合わせ" },
]

export function NavHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)

  const openChatbot = () => {
    window.dispatchEvent(new Event("hp-chatbot:open"))
    setMobileOpen(false)
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <nav className="glass-bar flex w-full items-center justify-between pl-4 pr-6 md:pl-4 md:pr-10 xl:pl-6 xl:pr-14 h-[69px]">
        <Link href="/" className="flex items-end gap-3 md:gap-4">
          <div
            className="relative shrink-0"
            style={{
              width: 87,
              height: 52,
            }}
          >
            <Image
              src="/nori_logo_header.svg"
              alt={SITE_BRAND_NAME}
              fill
              sizes="87px"
              className="object-contain"
              style={{ objectPosition: "center 30%" }}
              priority
            />
          </div>
          <div className="hidden sm:block">
            <p className="font-[var(--font-inter)] text-base font-bold tracking-tight text-black md:text-lg">
              {SITE_BRAND_NAME.toUpperCase()}
            </p>
            <p className="mt-1 text-[11px] tracking-wide text-neutral-500 md:text-xs">
              Norikane Film Design Office
            </p>
          </div>
        </Link>

        {/* Desktop nav */}
        <ul className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            // Hash anchors are section jumps, so the header keeps nav state neutral.
            return (
              <li key={item.label}>
                {item.type === "chatbot" ? (
                  <button
                    type="button"
                    onClick={openChatbot}
                    className="relative inline-flex items-center px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:text-black"
                  >
                    {item.label}
                  </button>
                ) : (
                  <Link
                    href={item.href}
                    className="relative inline-flex items-center px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:text-black"
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>

        {/* Mobile hamburger */}
        <button
          className="md:hidden rounded-xl border border-neutral-300 p-2 text-black transition-colors hover:bg-neutral-100"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "メニューを閉じる" : "メニューを開く"}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden">
          <ul
            className="glass-bar flex flex-col gap-1 px-6 py-3"
            style={{ borderTop: "1px solid rgba(0, 0, 0, 0.06)" }}
          >
            {navItems.map((item) => {
              return (
                <li key={item.label}>
                  {item.type === "chatbot" ? (
                    <button
                      type="button"
                      onClick={openChatbot}
                      className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-sm font-medium text-neutral-600 transition-colors hover:bg-black/5 hover:text-black"
                    >
                      {item.label}
                    </button>
                  ) : (
                    <Link
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-neutral-600 transition-colors hover:bg-black/5 hover:text-black"
                    >
                      {item.label}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </header>
  )
}
