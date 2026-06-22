// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import HomePage from "@/app/page"
import {
  DAVINCI_RESOLVE_TRAINER_TEXT,
  DAVINCI_RESOLVE_TRAINING_URL,
} from "@/lib/hp/davinci-trainer"
import { hpPublicContent } from "@/lib/hp/public-content"

vi.mock("@/components/hp/featured-works", () => ({
  FeaturedWorks: () => <div data-testid="featured-works" />,
}))

vi.mock("@/components/hp/hero-section", () => ({
  HeroSection: () => <section data-testid="hero-section" />,
}))

vi.mock("@/components/hp/home-schedule-section", () => ({
  HomeScheduleSection: () => <section data-testid="home-schedule-section" />,
}))

vi.mock("@/lib/feature-flags", () => ({
  isBookingEnabled: () => false,
}))

vi.mock("@/lib/notion/server/fetch-note", () => ({
  listPublishedNotes: vi.fn(async () => [
    {
      id: "note-correction",
      slug: "correction",
      title: "カラーコレクションとカラーグレーディングの違い",
      createdTime: "2026-01-01T00:00:00.000Z",
      lastEditedTime: "2026-01-01T00:00:00.000Z",
    },
  ]),
}))

describe("HomePage profile press dialog trigger", () => {
  afterEach(() => {
    cleanup()
  })

  it("uses the shared HP grid shell and spacing tokens for home sections", async () => {
    const globalsCss = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")
    expect(globalsCss).toContain("--hp-grid-columns: 12;")
    expect(globalsCss).toContain("--hp-grid-gutter: 24px;")
    expect(globalsCss).toContain("--hp-space-1: 8px;")
    expect(globalsCss).toContain("--hp-space-8: 64px;")
    expect(globalsCss).toContain(".hp-grid")
    expect(globalsCss).toContain("repeat(var(--hp-grid-columns), minmax(0, 1fr))")

    const { container } = render(await HomePage())

    expect(container.firstElementChild).toHaveClass("hp-section-stack")

    const philosophy = container.querySelector("#philosophy")
    expect(philosophy).toHaveClass("hp-section-shell")
    expect(philosophy?.querySelector(".hp-grid")).toBeInTheDocument()

    const notesScroller = philosophy?.querySelector(".overflow-x-auto")
    expect(notesScroller).toHaveClass("-mx-6", "md:-mx-10", "xl:-mx-14")

    const profile = container.querySelector("#profile")
    expect(profile).toHaveClass("hp-section-shell")
    expect(profile?.querySelector(".hp-profile-grid")).toHaveClass("hp-grid")
    expect(profile?.querySelector(".hp-career-item")).toBeInTheDocument()
  })

  it("renders the DaVinci Resolve certified trainer intro text as a direct official link", async () => {
    const { container } = render(await HomePage())

    const intro = container.querySelector(".hp-intro-measure")
    expect(intro).toBeInTheDocument()
    expect(intro).toHaveTextContent(hpPublicContent.intro)

    const officialLink = within(intro as HTMLElement).getByRole("link", {
      name: DAVINCI_RESOLVE_TRAINER_TEXT,
    })
    expect(officialLink).toHaveAttribute("href", DAVINCI_RESOLVE_TRAINING_URL)
    expect(officialLink).toHaveAttribute(
      "href",
      "https://www.blackmagicdesign.com/jp/products/davinciresolve/training#partners",
    )
    expect(new URL(DAVINCI_RESOLVE_TRAINING_URL).search).toBe("")
    expect(new URL(DAVINCI_RESOLVE_TRAINING_URL).hash).toBe("#partners")
    expect(DAVINCI_RESOLVE_TRAINING_URL).not.toContain(":~:text=")
    expect(DAVINCI_RESOLVE_TRAINING_URL).not.toContain("#TrainingType")
    expect(officialLink).toHaveAttribute("target", "_blank")
    expect(officialLink).toHaveAttribute("rel", "noopener noreferrer")
    expect(screen.queryByRole("dialog", { name: DAVINCI_RESOLVE_TRAINER_TEXT })).not.toBeInTheDocument()
    expect(within(intro as HTMLElement).queryByRole("button", {
      name: DAVINCI_RESOLVE_TRAINER_TEXT,
    })).not.toBeInTheDocument()
  })

  it("opens the press dialog from the profile badge on primary pointer release", async () => {
    render(await HomePage())

    const profile = screen.getByRole("heading", { name: "プロフィール" }).closest("section")
    expect(profile).toBeInTheDocument()

    const socialBadges = within(profile!).getAllByRole("link")
    expect(socialBadges.map((badge) => badge.getAttribute("aria-label"))).toEqual([
      "X",
      "YouTube",
      "Instagram",
    ])

    const trigger = within(profile!).getByRole("button", { name: "実績" })
    expect(trigger).toHaveClass("glass-btn--profile-social")
    expect(trigger).toHaveAttribute("aria-expanded", "false")

    fireEvent.pointerUp(trigger, { button: 0 })

    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("dialog", { name: "登壇・メディア掲載 / 実績" })).toBeVisible()
  })
})
