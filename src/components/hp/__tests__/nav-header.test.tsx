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
