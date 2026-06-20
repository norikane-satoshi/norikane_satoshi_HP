// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import HomePage from "@/app/page"

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
