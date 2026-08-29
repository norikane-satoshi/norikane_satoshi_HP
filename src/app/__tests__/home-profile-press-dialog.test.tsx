// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type {ReactNode} from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import HomePage from "@/app/page"
import {
  DAVINCI_RESOLVE_TRAINER_TEXT,
  DAVINCI_RESOLVE_TRAINING_URL,
} from "@/lib/hp/davinci-trainer"
import { hpPublicContent } from "@/lib/hp/public-content"
import { listPublishedNotes } from "@/lib/notion/server/fetch-note"

vi.mock("next-intl", () => ({
  hasLocale: (_locales: readonly string[], locale: string) => locale === "ja" || locale === "en",
  useLocale: () => "ja",
}))
vi.mock("next-intl/server", () => ({
  getLocale: async () => "ja",
  getTranslations: async () => (key: string) => ({notes: "ノート"}[key] ?? key),
}))
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children, className}: {href: string; children: ReactNode; className?: string}) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

vi.mock("@/components/hp/featured-works", () => ({
  FeaturedWorks: () => <div data-testid="featured-works" />,
}))

vi.mock("@/components/hp/hero-section", () => ({
  HeroSection: () => <section data-testid="hero-section" />,
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
    expect(screen.queryByRole("link", { name: "公式LINEを友だち追加" })).not.toBeInTheDocument()

    const philosophy = container.querySelector("#philosophy")
    expect(philosophy).toHaveClass("hp-section-shell")
    expect(philosophy?.querySelector(".hp-grid")).toBeInTheDocument()

    const notesScroller = philosophy?.querySelector(".overflow-x-auto")
    expect(notesScroller).toHaveClass("mx-[calc(var(--hp-section-padding-x)*-1)]")

    const profile = container.querySelector("#profile")
    expect(profile).toHaveClass("hp-section-shell")
    expect(profile?.querySelector(".hp-profile-grid")).toHaveClass("hp-grid")
    expect(profile?.querySelector(".hp-profile-grid")?.parentElement).toHaveClass(
      "mt-[var(--hp-space-4)]",
    )
    const profileSidebar = profile?.querySelector(".hp-profile-sidebar")
    expect(profileSidebar).toContainElement(screen.getByText(hpPublicContent.profile.name))
    expect(profileSidebar).toContainElement(screen.getByText(hpPublicContent.profile.title))
    expect(profile?.querySelector(".hp-career-item")).toBeInTheDocument()
    expect(container.querySelector("#schedule")).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "予約カレンダー" })).not.toBeInTheDocument()
  })

  it("keeps the home page available when the external notes query fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(listPublishedNotes).mockRejectedValueOnce(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
      }),
    )

    render(await HomePage())

    expect(screen.getByTestId("hero-section")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "プロフィール" })).toBeInTheDocument()
    expect(consoleError).toHaveBeenCalledWith("[HP_HOME_NOTES_FETCH_FAILED]", {
      event: "hp_home_notes_fetch_failed",
      errorName: "TypeError",
      causeName: "Error",
      causeCode: "ECONNRESET",
    })
    consoleError.mockRestore()
  })

  it("uses the 16px body tier for every career detail", async () => {
    const { container } = render(await HomePage())

    const careerDetails = container.querySelectorAll(".hp-career-body > .hp-body")
    expect(careerDetails).toHaveLength(hpPublicContent.profile.timeline.length)

    for (const detail of careerDetails) {
      expect(detail).toHaveClass("text-base")
      expect(detail).not.toHaveClass("text-xs")
      expect(detail).not.toHaveClass("md:text-sm")
    }
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
