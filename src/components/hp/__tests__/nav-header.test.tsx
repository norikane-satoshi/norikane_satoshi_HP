// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import React, { type ReactNode } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

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

import { NavHeader } from "@/components/hp/nav-header"

describe("NavHeader chatbot contact action", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("dispatches the chatbot open event from the desktop contact button", () => {
    const onOpen = vi.fn()
    window.addEventListener("hp-chatbot:open", onOpen)

    render(<NavHeader />)
    screen.getByRole("button", { name: "お問い合わせ" }).click()

    expect(onOpen).toHaveBeenCalledTimes(1)
    window.removeEventListener("hp-chatbot:open", onOpen)
  })

  it("keeps labels and destinations while ordering navigation as home notes profile contact", () => {
    const { container } = render(<NavHeader />)

    const desktopItems = Array.from(
      container.querySelectorAll("ul.hidden.md\\:flex > li"),
    )
    expect(desktopItems.map((item) => item.textContent?.trim())).toEqual([
      "ホーム",
      "ノート",
      "プロフィール",
      "お問い合わせ",
    ])
    expect(desktopItems[0]?.querySelector("a")).toHaveAttribute("href", "/")
    expect(desktopItems[1]?.querySelector("a")).toHaveAttribute(
      "href",
      "/#philosophy",
    )
    expect(desktopItems[2]?.querySelector("a")).toHaveAttribute("href", "/#profile")
    expect(desktopItems[3]?.querySelector("button")).toHaveTextContent(
      "お問い合わせ",
    )

    screen.getByRole("button", { name: "メニューを開く" }).click()
    const mobileMenu = Array.from(container.querySelectorAll("header ul")).at(-1)
    const mobileItems = Array.from(mobileMenu?.querySelectorAll("li") ?? [])
    expect(mobileItems.map((item) => item.textContent?.trim())).toEqual([
      "ホーム",
      "ノート",
      "プロフィール",
      "お問い合わせ",
    ])
    expect(mobileItems[0]?.querySelector("a")).toHaveAttribute("href", "/")
    expect(mobileItems[1]?.querySelector("a")).toHaveAttribute(
      "href",
      "/#philosophy",
    )
    expect(mobileItems[2]?.querySelector("a")).toHaveAttribute("href", "/#profile")
    expect(mobileItems[3]?.querySelector("button")).toHaveTextContent(
      "お問い合わせ",
    )
  })

  it("dispatches the chatbot open event and closes the mobile menu", () => {
    const onOpen = vi.fn()
    window.addEventListener("hp-chatbot:open", onOpen)

    render(<NavHeader />)
    screen.getByRole("button", { name: "メニューを開く" }).click()
    screen.getAllByRole("button", { name: "お問い合わせ" }).at(-1)?.click()

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "メニューを開く" })).toBeInTheDocument()
    window.removeEventListener("hp-chatbot:open", onOpen)
  })
})
