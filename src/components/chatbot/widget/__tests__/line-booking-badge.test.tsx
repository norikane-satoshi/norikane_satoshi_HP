// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { LineBookingBadge } from "@/components/chatbot/widget/line-booking-badge"

describe("LineBookingBadge", () => {
  afterEach(cleanup)

  it("opens a QR-code dialog and preserves the LINE follow URL", () => {
    render(<LineBookingBadge />)

    const trigger = screen.getByRole("button", { name: "公式LINEを友だち追加" })
    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("dialog", { name: "公式LINEを友だち追加" })).toHaveAttribute("aria-modal", "true")
    expect(decodeURIComponent(screen.getByRole("img", { name: "公式LINEを友だち追加するQRコード" }).getAttribute("src") ?? "")).toContain(
      "/line-friend-qr.png",
    )
    expect(screen.getByRole("link", { name: "LINEを開く" })).toHaveAttribute(
      "href",
      "https://line.me/R/ti/p/%40044ucnym",
    )
  })

  it.each([
    () => fireEvent.click(screen.getByRole("button", { name: "LINE QRコードを閉じる" })),
    () => fireEvent.keyDown(document, { key: "Escape" }),
    () => fireEvent.mouseDown(screen.getByTestId("line-qr-overlay")),
  ])("closes through each supported dismissal path", (closeDialog) => {
    render(<LineBookingBadge />)

    const trigger = screen.getByRole("button", { name: "公式LINEを友だち追加" })
    trigger.focus()
    fireEvent.click(trigger)
    closeDialog()

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
