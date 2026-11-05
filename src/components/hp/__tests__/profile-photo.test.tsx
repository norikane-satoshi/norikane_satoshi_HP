// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { HP_MODAL_OVERLAY_Z_INDEX } from "@/components/hp/modal-layer"
import { ProfilePhoto } from "@/components/hp/profile-photo"

describe("ProfilePhoto", () => {
  afterEach(() => {
    cleanup()
  })

  it("opens the biography above the chatbot side-peek layer", () => {
    render(<ProfilePhoto />)

    fireEvent.click(screen.getByRole("button", { name: "生い立ちを読む" }))

    const dialog = screen.getByRole("dialog", { name: "生い立ち" })

    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog.parentElement).toHaveStyle({
      zIndex: String(HP_MODAL_OVERLAY_Z_INDEX),
    })
    expect(dialog.parentElement).toHaveAttribute("data-hp-theme", "noir")
    expect(screen.getByRole("heading", { name: "丸亀に生まれる" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "白A（SIRO-A）" })).toHaveAttribute(
      "href",
      "https://www.siro-a.com/",
    )
  })

  it("closes the biography with Escape", async () => {
    render(<ProfilePhoto />)

    fireEvent.click(screen.getByRole("button", { name: "生い立ちを読む" }))
    fireEvent.keyDown(document, { key: "Escape" })

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "生い立ち" })).not.toBeInTheDocument(),
    )
  })

  it("keeps reduced-motion modal expansion static and uses the shared focus ring token", () => {
    const source = readFileSync(join(process.cwd(), "src/components/hp/profile-photo.tsx"), "utf8")

    expect(source).toContain('? { duration: 0 }')
    expect(source).toContain("focus-visible:ring-[var(--hp-color-accent-focus-ring)]")
  })
})
