// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ProfilePhoto } from "@/components/hp/profile-photo"

describe("ProfilePhoto", () => {
  afterEach(() => {
    cleanup()
  })

  it("keeps the modal centered within the non-chat side-peek area", () => {
    render(<ProfilePhoto />)

    fireEvent.click(screen.getByRole("button", { name: "プロフィール写真を拡大表示" }))

    const dialog = screen.getByRole("dialog", { name: "プロフィール写真" })

    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog.parentElement).toHaveStyle({
      right: "var(--chatbot-side-peek-occupied-width, 0px)",
    })
  })
})
