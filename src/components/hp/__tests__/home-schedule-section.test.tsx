// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import React, { type ReactNode } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const authMock = vi.hoisted(() => vi.fn())
const headersMock = vi.hoisted(() => vi.fn())

vi.mock("@/auth", () => ({
  auth: authMock,
}))

vi.mock("@/components/booking/booking-section", () => ({
  BookingSection: () => <div data-testid="booking-section" />,
}))

vi.mock("@/lib/auth/server/is-admin", () => ({
  isAdmin: () => false,
}))

vi.mock("next/headers", () => ({
  headers: headersMock,
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

function setHost(host: string) {
  headersMock.mockResolvedValue(new Headers({ host }))
}

describe("HomeScheduleSection booking flag", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(null)
    setHost("norikane.studio")
    delete process.env.NEXT_PUBLIC_ENABLE_BOOKING
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it.each(["norikane.studio", "preview-norikane.vercel.app", "localhost:3000"])(
    "renders no schedule entrypoint on %s when booking is disabled",
    async (host) => {
      setHost(host)

      await renderHomeScheduleSection()

      expect(screen.queryByRole("heading", { name: "予約カレンダー" })).not.toBeInTheDocument()
      expect(screen.queryByTestId("booking-section")).not.toBeInTheDocument()
      expect(screen.queryByRole("link", { name: "ログインして予約に進む" })).not.toBeInTheDocument()
      expect(document.querySelector("section#schedule")).not.toBeInTheDocument()
      expect(authMock).not.toHaveBeenCalled()
    },
  )

  it.each(["localhost:41238", "127.0.0.1:41238", "[::1]:41238"])(
    "renders the schedule section on the local verification host %s",
    async (host) => {
      setHost(host)

      await renderHomeScheduleSection()

      expect(document.querySelector("section#schedule")).toBeInTheDocument()
      expect(screen.getByRole("heading", { name: "予約カレンダー" })).toBeInTheDocument()
      expect(screen.getByRole("link", { name: "ログインして予約に進む" })).toBeInTheDocument()
      expect(screen.queryByTestId("booking-section")).not.toBeInTheDocument()
      expect(authMock).toHaveBeenCalledTimes(1)
    },
  )

  it("renders no schedule section, booking section, login link, or heading when booking is disabled", async () => {
    await renderHomeScheduleSection()

    expect(screen.queryByRole("heading", { name: "予約カレンダー" })).not.toBeInTheDocument()
    expect(screen.queryByTestId("booking-section")).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "ログインして予約に進む" })).not.toBeInTheDocument()
    expect(document.querySelector("section#schedule")).not.toBeInTheDocument()
    expect(authMock).not.toHaveBeenCalled()
  })

  it("renders the existing booking entrypoint when booking is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_BOOKING", "true")

    await renderHomeScheduleSection()

    expect(document.querySelector("section#schedule")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "予約カレンダー" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "ログインして予約に進む" })).toBeInTheDocument()
    expect(screen.queryByTestId("booking-section")).not.toBeInTheDocument()
    expect(authMock).toHaveBeenCalledTimes(1)
  })
})
