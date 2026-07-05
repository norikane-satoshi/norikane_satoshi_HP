// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BookingDone } from "@/components/booking/booking-done"
import { BookingFooter } from "@/components/booking/booking-footer"

describe("BookingDone", () => {
  afterEach(() => {
    cleanup()
  })

  it("keeps the email receipt copy for normal web bookings", () => {
    render(<BookingDone selectedSlots={[]} />)

    expect(screen.getByText(/確認メールをお送りしました/)).toBeInTheDocument()
  })

  it("switches the receipt copy for LINE LIFF bookings", () => {
    render(<BookingDone selectedSlots={[]} entryPoint="line_liff" />)

    expect(screen.getByText(/公式LINEに受付のお知らせを送ります/)).toBeInTheDocument()
    expect(screen.queryByText(/確認メールをお送りしました/)).not.toBeInTheDocument()
  })
})

describe("BookingFooter", () => {
  afterEach(() => {
    cleanup()
  })

  it("links the done-state booking history action to the my page history", () => {
    render(
      <BookingFooter
        step="done"
        canGoNext
        onBack={vi.fn()}
        onNext={vi.fn()}
        onReset={vi.fn()}
      />,
    )

    expect(screen.getByRole("link", { name: "マイページで予約一覧を見る" })).toHaveAttribute("href", "/booking/history")
  })
})
