// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { HP_MODAL_OVERLAY_Z_INDEX } from "@/components/hp/modal-layer"
import { ProfilePhoto } from "@/components/hp/profile-photo"

describe("ProfilePhoto", () => {
  afterEach(() => {
    cleanup()
  })

  it("keeps the modal above the chatbot side-peek layer", () => {
    render(<ProfilePhoto />)

    fireEvent.click(screen.getByRole("button", { name: "プロフィール写真を拡大表示" }))

    const dialog = screen.getByRole("dialog", { name: "プロフィール写真" })

    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog.parentElement).toHaveStyle({
      zIndex: String(HP_MODAL_OVERLAY_Z_INDEX),
    })
  })

  it("keeps reduced-motion modal expansion static and uses the shared focus ring token", () => {
    const source = readFileSync(join(process.cwd(), "src/components/hp/profile-photo.tsx"), "utf8")

    expect(source).toContain('? { duration: 0 }')
    expect(source).toContain("focus-visible:ring-[var(--hp-color-accent-focus-ring)]")
  })
})
