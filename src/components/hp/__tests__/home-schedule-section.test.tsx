// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import React, { type ReactNode } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const authMock = vi.hoisted(() => vi.fn())
const featureFlags = vi.hoisted(() => ({
  isBookingEnabled: vi.fn(() => false),
}))

vi.mock("@/auth", () => ({
  auth: authMock,
}))

vi.mock("@/components/booking/booking-section", () => ({
  BookingSection: () => <div data-testid="booking-section" />,
}))

vi.mock("@/lib/auth/server/is-admin", () => ({
  isAdmin: () => false,
}))

vi.mock("@/lib/feature-flags", () => ({
  isBookingEnabled: featureFlags.isBookingEnabled,
}))

vi.mock("next/link", () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

import { HomeScheduleSection } from "@/components/hp/home-schedule-section"

async function renderHomeScheduleSection() {
  render(await HomeScheduleSection())
}

describe("HomeScheduleSection booking flag", () => {
  beforeEach(() => {
    authMock.mockResolvedValue(null)
    featureFlags.isBookingEnabled.mockReturnValue(false)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders no schedule section, booking section, login link, or heading when booking is disabled", async () => {
    await renderHomeScheduleSection()

    expect(screen.queryByRole("heading", { name: "予約カレンダー" })).not.toBeInTheDocument()
    expect(screen.queryByTestId("booking-section")).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "ログインして予約に進む" })).not.toBeInTheDocument()
    expect(document.querySelector("section#schedule")).not.toBeInTheDocument()
    expect(authMock).not.toHaveBeenCalled()
  })

  it("renders the existing booking entrypoint when booking is enabled", async () => {
    featureFlags.isBookingEnabled.mockReturnValue(true)

    await renderHomeScheduleSection()

    expect(document.querySelector("section#schedule")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "予約カレンダー" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "ログインして予約に進む" })).toBeInTheDocument()
    expect(screen.queryByTestId("booking-section")).not.toBeInTheDocument()
    expect(authMock).toHaveBeenCalledTimes(1)
  })
})
