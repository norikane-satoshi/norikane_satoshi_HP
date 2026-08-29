// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import React, { type ReactNode } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const featureFlags = vi.hoisted(() => ({
  isBookingEnabled: vi.fn(() => false),
}))

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    className,
    onClick,
    children,
  }: {
    href: string
    className?: string
    onClick?: () => void
    children: ReactNode
  }) => (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  ),
  usePathname: () => "/",
}))

vi.mock("next-intl", () => ({
  useLocale: () => "ja",
  useTranslations: () => (key: string) => ({
    home: "ホーム",
    notes: "ノート",
    profile: "プロフィール",
    booking: "予約カレンダー",
    openMenu: "メニューを開く",
    closeMenu: "メニューを閉じる",
    language: "表示言語",
    switchToJapanese: "日本語で表示",
    switchToEnglish: "英語で表示",
  }[key] ?? key),
}))

vi.mock("next/image", () => ({
  default: ({ alt, src, className }: { alt: string; src: string; className?: string }) => (
    <span aria-label={alt} className={className} data-src={src} />
  ),
}))

vi.mock("@/lib/feature-flags", () => ({
  isBookingEnabled: featureFlags.isBookingEnabled,
}))

import { NavHeader } from "@/components/hp/nav-header"

describe("NavHeader navigation", () => {
  beforeEach(() => {
    featureFlags.isBookingEnabled.mockReturnValue(false)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("keeps labels and destinations while ordering navigation as home notes profile", () => {
    const { container } = render(<NavHeader />)

    const desktopItems = Array.from(
      container.querySelectorAll("ul.hidden.md\\:flex > li"),
    ).filter((item) => item.querySelector("a"))
    expect(desktopItems.map((item) => item.textContent?.trim())).toEqual([
      "ホーム",
      "ノート",
      "プロフィール",
    ])
    expect(desktopItems[0]?.querySelector("a")).toHaveAttribute("href", "/")
    expect(desktopItems[1]?.querySelector("a")).toHaveAttribute(
      "href",
      "/#philosophy",
    )
    expect(desktopItems[2]?.querySelector("a")).toHaveAttribute("href", "/#profile")
    expect(screen.queryByRole("button", { name: "お問い合わせ" })).not.toBeInTheDocument()

    screen.getByRole("button", { name: "メニューを開く" }).click()
    const mobileMenu = Array.from(container.querySelectorAll("header ul")).at(-1)
    const mobileItems = Array.from(mobileMenu?.querySelectorAll("li") ?? []).filter((item) => item.querySelector("a"))
    expect(mobileItems.map((item) => item.textContent?.trim())).toEqual([
      "ホーム",
      "ノート",
      "プロフィール",
    ])
    expect(mobileItems[0]?.querySelector("a")).toHaveAttribute("href", "/")
    expect(mobileItems[1]?.querySelector("a")).toHaveAttribute(
      "href",
      "/#philosophy",
    )
    expect(mobileItems[2]?.querySelector("a")).toHaveAttribute("href", "/#profile")
    expect(screen.queryByRole("button", { name: "お問い合わせ" })).not.toBeInTheDocument()
  })

  it("shows the booking calendar link after profile when booking is enabled", () => {
    featureFlags.isBookingEnabled.mockReturnValue(true)

    const { container } = render(<NavHeader />)

    const desktopItems = Array.from(
      container.querySelectorAll("ul.hidden.md\\:flex > li"),
    ).filter((item) => item.querySelector("a"))
    expect(desktopItems.map((item) => item.textContent?.trim())).toEqual([
      "ホーム",
      "ノート",
      "プロフィール",
      "予約カレンダー",
    ])
    expect(desktopItems[3]?.querySelector("a")).toHaveAttribute("href", "/#schedule")

    screen.getByRole("button", { name: "メニューを開く" }).click()
    const mobileMenu = Array.from(container.querySelectorAll("header ul")).at(-1)
    const mobileItems = Array.from(mobileMenu?.querySelectorAll("li") ?? []).filter((item) => item.querySelector("a"))
    expect(mobileItems.map((item) => item.textContent?.trim())).toEqual([
      "ホーム",
      "ノート",
      "プロフィール",
      "予約カレンダー",
    ])
    expect(mobileItems[3]?.querySelector("a")).toHaveAttribute("href", "/#schedule")
  })
})
