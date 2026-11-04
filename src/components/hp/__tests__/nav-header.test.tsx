// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import React, { type ReactNode } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const featureFlags = vi.hoisted(() => ({
  isBookingEnabled: vi.fn(() => false),
}))

vi.mock("next/link", () => ({
  default: ({
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
}))

vi.mock("next/image", () => ({
  default: ({ alt, src, className }: { alt: string; src: string; className?: string }) => (
    <span aria-label={alt} className={className} data-src={src} />
  ),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
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

  const NAV_LABELS = ["作品", "ノート", "プロフィール", "登壇・掲載"]
  const NAV_HREFS = ["/#works", "/#philosophy", "/#profile", "/#press"]

  function readItems(items: Element[]) {
    return items.map((item) => [item.textContent?.trim(), item.querySelector("a")?.getAttribute("href")])
  }

  it("orders navigation as works, notes, profile, press on desktop and mobile", () => {
    const { container } = render(<NavHeader />)

    const expected = NAV_LABELS.map((label, index) => [label, NAV_HREFS[index]])
    const desktopItems = Array.from(container.querySelectorAll("ul.hidden.md\\:flex > li"))
    expect(readItems(desktopItems)).toEqual(expected)
    expect(screen.queryByRole("button", { name: "お問い合わせ" })).not.toBeInTheDocument()

    screen.getByRole("button", { name: "メニューを開く" }).click()
    const mobileMenu = Array.from(container.querySelectorAll("header ul")).at(-1)
    expect(readItems(Array.from(mobileMenu?.querySelectorAll("li") ?? []))).toEqual(expected)
  })

  it("shows the booking calendar link last when booking is enabled", () => {
    featureFlags.isBookingEnabled.mockReturnValue(true)

    const { container } = render(<NavHeader />)

    const expected = [
      ...NAV_LABELS.map((label, index) => [label, NAV_HREFS[index]]),
      ["予約カレンダー", "/#schedule"],
    ]
    const desktopItems = Array.from(container.querySelectorAll("ul.hidden.md\\:flex > li"))
    expect(readItems(desktopItems)).toEqual(expected)

    screen.getByRole("button", { name: "メニューを開く" }).click()
    const mobileMenu = Array.from(container.querySelectorAll("header ul")).at(-1)
    expect(readItems(Array.from(mobileMenu?.querySelectorAll("li") ?? []))).toEqual(expected)
  })
})
