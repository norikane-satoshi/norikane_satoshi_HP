"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { SITE_BRAND_NAME, SITE_OWNER_NAME } from "@/lib/site-brand"

const navItems = [
  { href: "/", label: "ホーム" },
  { href: "/#profile", label: "プロフィール" },
  { href: "/#philosophy", label: "ノート" },
  { href: "/#contact", label: "お問い合わせ" },
]

export function NavHeader() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <nav className="glass-bar flex w-full items-center justify-between pl-4 pr-6 md:pl-4 md:pr-10 xl:pl-6 xl:pr-14 h-[88px]">
        <Link href="/" className="flex items-center gap-3 md:gap-4">
          <div
            className="relative shrink-0"
            style={{
              width: 102,
              height: 61,
            }}
          >
            <Image
              src="/nori_logo_header.svg"
              alt={SITE_BRAND_NAME}
              fill
              sizes="102px"
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
            const isActive = pathname === item.href
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "relative inline-flex items-center px-4 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "text-black"
                      : "text-neutral-600 hover:text-black"
                  )}
                >
                  {item.label}
                  {isActive && (
                    <span
                      className="absolute left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                      style={{
                        bottom: 2,
                        background: "var(--accent-primary)",
                      }}
                    />
                  )}
                </Link>
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
              const isActive = pathname === item.href
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors",
                      isActive
                        ? "text-black"
                        : "text-neutral-600 hover:text-black hover:bg-black/5"
                    )}
                  >
                    {isActive && (
                      <span
                        className="h-1 w-1 rounded-full"
                        style={{ background: "var(--accent-primary)" }}
                      />
                    )}
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </header>
  )
}
