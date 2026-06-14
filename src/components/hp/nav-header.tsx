"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, X } from "lucide-react"
import { isBookingEnabled } from "@/lib/feature-flags"
import { SITE_BRAND_NAME } from "@/lib/site-brand"

type SectionId = "home" | "profile" | "philosophy" | "schedule"
type NavItem = { href: string; label: string; sectionId: SectionId }

const baseNavItems: NavItem[] = [
  { href: "/", label: "ホーム", sectionId: "home" as const },
  { href: "/#philosophy", label: "ノート", sectionId: "philosophy" as const },
  { href: "/#profile", label: "プロフィール", sectionId: "profile" as const },
]

const bookingNavItem: NavItem = {
  href: "/#schedule",
  label: "予約カレンダー",
  sectionId: "schedule",
}

export function NavHeader() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionId>("home")
  const bookingEnabled = isBookingEnabled()
  const navItems = useMemo(
    () => (bookingEnabled ? [...baseNavItems, bookingNavItem] : baseNavItems),
    [bookingEnabled],
  )
  const sectionIds = useMemo(
    () => navItems.map((item) => item.sectionId),
    [navItems],
  )

  useEffect(() => {
    const updateActiveSection = () => {
      if (pathname.startsWith("/notes")) {
        setActiveSection("philosophy")
        return
      }
      if (pathname !== "/") {
        setActiveSection("home")
        return
      }

      const anchorLine = 128
      const viewportBias = window.innerHeight * 0.22
      let nextSection: SectionId = "home"
      let nearestTop = Number.NEGATIVE_INFINITY

      for (const id of sectionIds) {
        const element = document.getElementById(id)
        if (!element) continue
        const top = element.getBoundingClientRect().top
        if (top <= anchorLine + viewportBias && top > nearestTop) {
          nextSection = id
          nearestTop = top
        }
      }

      setActiveSection(nextSection)
    }

    updateActiveSection()

    if (typeof globalThis.IntersectionObserver === "undefined") {
      window.addEventListener("scroll", updateActiveSection, { passive: true })
      window.addEventListener("resize", updateActiveSection)
      window.addEventListener("hashchange", updateActiveSection)
      return () => {
        window.removeEventListener("scroll", updateActiveSection)
        window.removeEventListener("resize", updateActiveSection)
        window.removeEventListener("hashchange", updateActiveSection)
      }
    }

    const observer = new IntersectionObserver(updateActiveSection, {
      rootMargin: "-22% 0px -58% 0px",
      threshold: [0, 0.2, 0.55],
    })
    sectionIds.forEach((id) => {
      const element = document.getElementById(id)
      if (element) observer.observe(element)
    })
    window.addEventListener("hashchange", updateActiveSection)

    return () => {
      observer.disconnect()
      window.removeEventListener("hashchange", updateActiveSection)
    }
  }, [pathname, sectionIds])

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <nav className="glass-bar flex w-full items-center justify-between pl-4 pr-6 md:pl-4 md:pr-10 xl:pl-6 xl:pr-14 h-[69px]">
        <Link href="/" className="flex shrink-0 items-center">
          <Image
            src="/nori_header_black.svg"
            alt={SITE_BRAND_NAME}
            width={1165}
            height={137}
            sizes="(max-width: 767px) 320px, 380px"
            className="h-[clamp(36px,5vw,44px)] w-auto object-contain"
            priority
          />
        </Link>

        {/* Desktop nav */}
        <ul className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = activeSection === item.sectionId
            return (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className="hp-nav-link relative inline-flex items-center gap-2 rounded-[12px] px-4 py-2 text-sm font-medium"
                  aria-current={isActive ? "location" : undefined}
                >
                  <span className="hp-nav-dot" aria-hidden="true" />
                  {item.label}
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
              const isActive = activeSection === item.sectionId
              return (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className="hp-nav-link flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium hover:bg-black/5"
                    aria-current={isActive ? "location" : undefined}
                  >
                    <span className="hp-nav-dot" aria-hidden="true" />
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
