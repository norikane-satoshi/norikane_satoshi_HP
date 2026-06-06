// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FEATURED_WORKS, LIVE_REEL_VIDEO_IDS } from "@/components/hp/featured-works-data"
import {
  FeaturedWorks,
  getFeaturedWorkMarqueeProgressBarGeometry,
} from "@/components/hp/featured-works"

describe("FeaturedWorks", () => {
  const embeddedWorkCount = FEATURED_WORKS.filter((work) => work.youtubeId).length
  const getPrimarySegment = (container: HTMLElement) => {
    const segment = container.querySelector(
      '[data-featured-work-marquee-segment="primary"]',
    )
    expect(segment).toBeInTheDocument()
    return segment as HTMLElement
  }

  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders non-navigating work cards with only badge links", () => {
    render(<FeaturedWorks />)

    for (const work of FEATURED_WORKS) {
      const card = screen.getByLabelText(`${work.title} 作品カード`)
      expect(card).toBeInTheDocument()
      expect(card.tagName).toBe("DIV")
      expect(card).not.toHaveAttribute("href")

      const visibleLinks = work.youtubeId
        ? work.links.filter((link) => link.label !== "YouTube")
        : work.links

      for (const link of visibleLinks) {
        const badge = screen.getByRole("link", {
          name: `${work.title} ${link.label}を新しいタブで開く`,
        })
        expect(badge).toHaveAttribute("href", link.url)
        expect(badge).toHaveAttribute("target", "_blank")
        expect(badge).toHaveAttribute("rel", "noopener noreferrer")
      }

      if (work.youtubeId) {
        expect(
          screen.queryByRole("link", {
            name: `${work.title} YouTubeを新しいタブで開く`,
          }),
        ).not.toBeInTheDocument()
      }
    }
  })

  it("uses only the Featured Works label and renders a scroll-driven marquee shell", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    const { container } = render(<FeaturedWorks />)

    expect(screen.getByText("Featured Works")).toBeInTheDocument()
    expect(screen.queryByText("代表作品")).not.toBeInTheDocument()
    expect(container.innerHTML).not.toContain(">代表作品<")

    const viewport = container.querySelector(
      '[data-featured-work-marquee-viewport="true"]',
    )
    const track = container.querySelector(
      '[data-featured-work-marquee-track="continuous"]',
    )
    const primary = getPrimarySegment(container)
    const clone = container.querySelector(
      '[data-featured-work-marquee-segment="clone"]',
    )
    const clones = container.querySelectorAll(
      '[data-featured-work-marquee-segment="clone"]',
    )
    const cloneBeforeStart = container.querySelector(
      '[data-featured-work-marquee-segment-start="clone-before"]',
    )
    const cloneAfterStart = container.querySelector(
      '[data-featured-work-marquee-segment-start="clone-after"]',
    )
    const progressTrack = container.querySelector(
      '[data-featured-work-marquee-progress-track="true"]',
    )
    const progressThumb = container.querySelector(
      '[data-featured-work-marquee-progress-thumb="true"]',
    )

    expect(viewport).toHaveClass("overflow-x-auto")
    expect(viewport).toHaveClass("overflow-y-hidden")
    expect(viewport).toHaveAttribute("tabindex", "0")
    expect(viewport).toHaveAttribute("data-featured-work-marquee-idle-ms", "1300")
    expect(viewport).toHaveAttribute("data-featured-work-native-scrollbar", "hidden")
    expect(progressTrack).toBeInTheDocument()
    expect(progressTrack).toHaveClass("w-full")
    expect(progressThumb).toBeInTheDocument()
    expect(track).toHaveClass("w-max")
    expect(track).toHaveClass("gap-0")
    expect(track).not.toHaveClass("gap-4")
    expect(track).not.toHaveClass("md:gap-5")
    expect(track).toHaveClass("px-8")
    expect(track).not.toHaveClass("will-change-transform")
    expect(track?.textContent).toContain("火星の女王")
    expect(primary.querySelectorAll("[data-featured-work-card]")).toHaveLength(
      FEATURED_WORKS.length,
    )
    expect(primary).toHaveClass("contents")
    expect(primary).not.toHaveClass("gap-4")
    expect(primary).not.toHaveClass("px-8")
    expect(clones).toHaveLength(2)
    expect(clone).toHaveAttribute("aria-hidden", "true")
    expect(clone).toHaveClass("contents")
    expect(clone).not.toHaveClass("gap-4")
    expect(clone).not.toHaveClass("px-8")
    expect(clone?.querySelectorAll("[data-featured-work-card]")).toHaveLength(
      FEATURED_WORKS.length,
    )
    expect(cloneBeforeStart).toBeInTheDocument()
    expect(primary.querySelector(
      '[data-featured-work-marquee-segment-start="primary"]',
    )).toBeInTheDocument()
    expect(cloneAfterStart).toBeInTheDocument()
    expect(container.querySelector("style")?.textContent).not.toContain(
      "@keyframes featured-works-marquee",
    )
    expect(container.querySelector("style")?.textContent).toContain(
      "prefers-reduced-motion: reduce",
    )
  })

  it("pauses autoplay from input events without relying on scroll events", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    const { container } = render(<FeaturedWorks />)
    const viewport = container.querySelector(
      '[data-featured-work-marquee-viewport="true"]',
    ) as HTMLElement

    expect(viewport.dataset.featuredWorkMarqueeState).not.toBe("paused")
    fireEvent.scroll(viewport)
    expect(viewport.dataset.featuredWorkMarqueeState).not.toBe("paused")

    fireEvent.wheel(viewport)
    expect(viewport).toHaveAttribute("data-featured-work-marquee-state", "paused")

    viewport.dataset.featuredWorkMarqueeState = "running"
    fireEvent.keyDown(viewport, { key: "ArrowRight" })
    expect(viewport).toHaveAttribute("data-featured-work-marquee-state", "paused")
  })

  it("does not render the clone track when reduced motion is requested", () => {
    const { container } = render(<FeaturedWorks />)

    expect(screen.getByText("Featured Works")).toBeInTheDocument()
    expect(
      container.querySelector('[data-featured-work-marquee-segment="primary"]'),
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-featured-work-marquee-segment="clone"]'),
    ).not.toBeInTheDocument()
    expect(
      container.querySelector('[data-featured-work-marquee-progress-track="true"]'),
    ).not.toBeInTheDocument()
    expect(
      container.querySelector('[data-featured-work-marquee-viewport="true"]'),
    ).not.toHaveAttribute("data-featured-work-native-scrollbar")
  })

  it("renders the live reel card without badge links", () => {
    render(<FeaturedWorks />)

    expect(screen.getByLabelText("ライブ映像作品多数のランダムループ再生カード")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /ライブ映像作品多数/ })).not.toBeInTheDocument()
  })

  it("opens video previews in a body portal modal and restores focus", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(<FeaturedWorks />)

    const work = FEATURED_WORKS.find((item) => item.youtubeId)
    expect(work?.youtubeId).toBeDefined()

    const trigger = screen.getByRole("button", {
      name: `${work?.title} の動画をモーダルで再生`,
    })
    fireEvent.click(trigger)

    const dialog = screen.getByRole("dialog", {
      name: `${work?.title} の動画をモーダルで再生`,
    })
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog.parentElement).toBe(document.body.lastElementChild)
    expect(dialog.parentElement).toHaveClass(
      "fixed",
      "inset-0",
      "z-[100]",
      "bg-[rgba(8,4,24,0.42)]",
      "p-4",
      "md:p-8",
    )
    expect(dialog.parentElement).toHaveStyle({
      right: "var(--chatbot-side-peek-occupied-width, 0px)",
    })

    const iframe = dialog.querySelector("iframe")
    expect(iframe).toHaveAttribute(
      "src",
      expect.stringContaining(`youtube-nocookie.com/embed/${work?.youtubeId}`),
    )
    expect(iframe).toHaveAttribute("allow", expect.stringContaining("autoplay"))
    expect(iframe?.parentElement).toHaveClass("aspect-video")
    expect(document.body.style.overflow).toBe("hidden")

    const close = screen.getByRole("button", { name: "動画モーダルを閉じる" })
    expect(close).toHaveFocus()
    fireEvent.click(close)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe("")
  })

  it("opens the live reel modal with the currently previewed video id", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(<FeaturedWorks />)

    const trigger = screen.getByRole("button", {
      name: "ライブ映像作品をモーダルで再生",
    })
    fireEvent.click(trigger)

    const dialog = screen.getByRole("dialog", {
      name: "ライブ映像作品をモーダルで再生",
    })
    const iframe = dialog.querySelector("iframe")
    expect(iframe).toHaveAttribute(
      "src",
      expect.stringContaining(`youtube-nocookie.com/embed/${LIVE_REEL_VIDEO_IDS[0]}`),
    )
  })

  it("ignores video trigger clicks after pointer dragging", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(<FeaturedWorks />)

    const work = FEATURED_WORKS.find((item) => item.youtubeId)
    const trigger = screen.getByRole("button", {
      name: `${work?.title} の動画をモーダルで再生`,
    })

    fireEvent.pointerDown(trigger, { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(trigger, { clientX: 24, clientY: 0 })
    fireEvent.click(trigger)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps each preview in a native 16:9 frame with safe covers", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    const { container } = render(<FeaturedWorks />)

    const primary = getPrimarySegment(container)
    const previewFrames = primary.querySelectorAll(".aspect-video")
    const cropFrames = primary.querySelectorAll("[data-featured-work-preview-crop]")
    const scaledMedia = primary.querySelectorAll(
      '[data-featured-work-preview-media="youtube-scale"]',
    )
    const thumbnailCovers = primary.querySelectorAll(
      '[data-featured-work-preview-thumbnail="visible"]',
    )
    const mediaCovers = primary.querySelectorAll("[data-featured-work-preview-media]")
    const abstractCovers = primary.querySelectorAll(
      '[data-featured-work-abstract-cover="true"]',
    )
    const neutralPlaceholders = primary.querySelectorAll(
      "[data-featured-work-neutral-placeholder]",
    )

    expect(previewFrames).toHaveLength(embeddedWorkCount + 2)
    expect(abstractCovers).toHaveLength(1)
    expect(cropFrames).toHaveLength(0)
    expect(scaledMedia).toHaveLength(0)
    expect(thumbnailCovers).toHaveLength(embeddedWorkCount + 1)
    expect(mediaCovers).toHaveLength(embeddedWorkCount + 1)
    expect(neutralPlaceholders).toHaveLength(0)
    expect(container.innerHTML).not.toContain("i.ytimg.com/vi/IQb3beIbE1I")

    const marsCard = screen.getByLabelText("火星の女王 作品カード")
    const marsFrame = marsCard.querySelector('[data-featured-work-abstract-cover="true"]')
    expect(marsFrame).toHaveClass("aspect-video")
    expect(marsCard.querySelector('[data-featured-work-preview-media]')).toBeNull()
    expect(marsCard.querySelector("img")).toBeNull()

    for (const frame of previewFrames) {
      expect(frame).toHaveClass("aspect-video")
      expect(frame).toHaveClass("overflow-hidden")
      expect(frame).toHaveClass("-mt-4")
      expect(frame).toHaveClass("-mx-4")
      expect(frame).toHaveClass("rounded-none")
      expect(frame).not.toHaveClass("rounded-t-[12px]")
      expect(frame).not.toHaveClass("rounded-[12px]")
      expect(frame).not.toHaveClass("border")
      expect(frame).not.toHaveClass("bg-white/35")
    }

    for (const thumbnail of thumbnailCovers) {
      expect(thumbnail).toHaveClass("rounded-none")
      expect(thumbnail).not.toHaveClass("rounded-[12px]")
    }

    for (const media of mediaCovers) {
      expect(media).toHaveClass("rounded-none")
      expect(media).not.toHaveClass("rounded-[12px]")
    }

    for (const work of FEATURED_WORKS) {
      const card = screen.getByLabelText(`${work.title} 作品カード`)
      expect(card).toHaveClass("overflow-hidden")
      expect(card).toHaveClass("featured-work-transparent-card")
      expect(card).toHaveClass("rounded-none")
      expect(card).not.toHaveClass("glass-card-sm")
      expect(card).not.toHaveClass("glass-refraction-edge")
      expect(card).not.toHaveClass("glass-distortion-surface")
    }
    const liveReelCard = screen.getByLabelText("ライブ映像作品多数のランダムループ再生カード")
    expect(liveReelCard).toHaveClass("overflow-hidden")
    expect(liveReelCard).toHaveClass("featured-work-transparent-card")
    expect(liveReelCard).toHaveClass("rounded-none")
    expect(liveReelCard).not.toHaveClass("glass-card-sm")
    expect(liveReelCard).not.toHaveClass("glass-refraction-edge")
    expect(liveReelCard).not.toHaveClass("glass-distortion-surface")
  })

  it("places video work badge groups inline with clients", () => {
    const { container } = render(<FeaturedWorks />)

    for (const work of FEATURED_WORKS.filter((item) => item.youtubeId)) {
      const card = screen.getByLabelText(`${work.title} 作品カード`)
      const badges = card.querySelector('[data-featured-work-link-badges="inline"]')
      expect(badges).toBeInTheDocument()
      expect(badges).toHaveClass("flex")
      expect(badges).toHaveClass("justify-end")
      expect(badges?.querySelector('[data-featured-work-link-badge="YouTube"]')).toBeNull()
      expect(badges).not.toHaveClass("absolute")
      expect(badges).not.toHaveClass("mt-3")
      expect(badges).not.toHaveClass("bottom-2")
      expect(badges).not.toHaveClass("right-2")
      expect(badges).not.toHaveClass("z-30")

      const title = Array.from(card.querySelectorAll("p")).find(
        (element) => element.textContent === work.title,
      )
      const client = Array.from(card.querySelectorAll("p")).find(
        (element) => element.textContent === work.client,
      )
      const metaRow = title?.nextElementSibling
      expect(title).toBeInTheDocument()
      expect(client).toBeInTheDocument()
      expect(metaRow).toBe(client?.parentElement)
      expect(badges?.parentElement).toBe(client?.parentElement)
      expect(metaRow).toHaveClass("mt-auto")
      expect(metaRow).toHaveClass("flex")
    }

    const primary = getPrimarySegment(container)
    const badgeGroups = primary.querySelectorAll("[data-featured-work-link-badges]")
    expect(badgeGroups).toHaveLength(FEATURED_WORKS.length)
    expect(
      screen
        .getByLabelText("ライブ映像作品多数のランダムループ再生カード")
        .querySelector("[data-featured-work-link-badges]"),
    ).toBeNull()
  })

  it("places Mars badges inside an abstract cover without media", () => {
    const { container } = render(<FeaturedWorks />)
    const mars = FEATURED_WORKS.find((work) => work.title === "火星の女王")
    expect(mars).toBeDefined()

    const card = screen.getByLabelText("火星の女王 作品カード")
    const abstractCover = card.querySelector(
      '[data-featured-work-abstract-cover="true"]',
    )
    const badges = abstractCover?.querySelector(
      '[data-featured-work-link-badges="inline"]',
    )
    const title = Array.from(card.querySelectorAll("p")).find(
      (element) => element.textContent === "火星の女王",
    )
    const client = Array.from(card.querySelectorAll("p")).find(
      (element) => element.textContent === mars?.client,
    )
    const metaRow = title?.nextElementSibling

    expect(abstractCover).toHaveClass("aspect-video")
    expect(abstractCover).toHaveClass("overflow-hidden")
    expect(abstractCover).toHaveClass("-mt-4")
    expect(abstractCover).toHaveClass("-mx-4")
    expect(abstractCover).toHaveClass("rounded-none")
    expect(abstractCover).not.toHaveClass("rounded-t-[12px]")
    expect(abstractCover?.querySelector("img")).toBeNull()
    expect(abstractCover?.querySelector('[data-featured-work-preview-media]')).toBeNull()
    expect(abstractCover?.querySelector("iframe")).toBeNull()
    expect(abstractCover).toHaveAttribute("data-hp-color-field", "cinematic-neutral")
    expect(abstractCover?.querySelector('[data-hp-abstract-art="mars"]')).toBeNull()
    expect(badges).toBeInTheDocument()
    expect(badges).toHaveAttribute("data-featured-work-link-badges-layout", "two-row")
    expect(title).toBeInTheDocument()
    expect(abstractCover?.nextElementSibling).toBe(title)
    expect(client).toBeInTheDocument()
    expect(metaRow).toBe(client?.parentElement)
    expect(metaRow?.querySelector("[data-featured-work-link-badges]")).toBeNull()

    for (const link of mars?.links ?? []) {
      const badge = abstractCover?.querySelector(
        `[data-featured-work-link-badge="${link.label}"]`,
      )
      expect(badge).toHaveAttribute("href", link.url)
      expect(badge).toHaveAttribute("target", "_blank")
      expect(badge).toHaveAttribute("rel", "noopener noreferrer")
      expect(badge).toHaveAttribute(
        "aria-label",
        `火星の女王 ${link.label}を新しいタブで開く`,
      )
    }

    expect((mars?.links ?? []).map((link) => link.label)).toEqual([
      "作品HP",
      "YouTube",
      "ショット集1",
      "2",
      "3",
    ])

    const rows = badges?.querySelectorAll("[data-featured-work-link-badge-row]")
    expect(rows).toHaveLength(2)
    expect(rows?.[0]).toHaveAttribute("data-featured-work-link-badge-row", "top")
    expect(rows?.[1]).toHaveAttribute("data-featured-work-link-badge-row", "bottom")
    expect(
      Array.from(rows?.[0]?.querySelectorAll("[data-featured-work-link-badge]") ?? [])
        .map((badge) => badge.textContent),
    ).toEqual(["作品HP", "YouTube"])
    expect(
      Array.from(rows?.[1]?.querySelectorAll("[data-featured-work-link-badge]") ?? [])
        .map((badge) => badge.textContent),
    ).toEqual(["ショット集1", "2", "3"])

    expect(
      getPrimarySegment(container).querySelectorAll(
        '[data-featured-work-abstract-cover="true"]',
      ),
    ).toHaveLength(1)
  })

  it("renders Rilakkuma as a playable Netflix video card with inline badges", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    render(<FeaturedWorks />)

    const card = screen.getByLabelText("リラックマと遊園地 作品カード")
    const title = Array.from(card.querySelectorAll("p")).find(
      (element) => element.textContent === "リラックマと遊園地",
    )
    const client = Array.from(card.querySelectorAll("p")).find(
      (element) => element.textContent === "NETFLIX",
    )
    const frame = card.querySelector(".aspect-video")
    const thumbnail = card.querySelector(
      '[data-featured-work-preview-thumbnail="visible"]',
    )
    const media = card.querySelector('[data-featured-work-preview-media="preparing"]')
    const badges = card.querySelector('[data-featured-work-link-badges="inline"]')

    expect(card.tagName).toBe("DIV")
    expect(card).not.toHaveAttribute("href")
    expect(frame).toHaveClass("aspect-video")
    expect(frame).toHaveClass("overflow-hidden")
    expect(frame).toHaveClass("-mt-4")
    expect(frame).toHaveClass("-mx-4")
    expect(frame).toHaveClass("rounded-none")
    expect(frame).not.toHaveClass("rounded-t-[12px]")
    expect(thumbnail).toBeInTheDocument()
    expect(thumbnail).toHaveClass("rounded-none")
    expect(media).toBeInTheDocument()
    expect(media).toHaveClass("rounded-none")
    expect(title).toBeInTheDocument()
    expect(client).toBeInTheDocument()
    expect(title?.nextElementSibling).toBe(client?.parentElement)
    expect(badges?.parentElement).toBe(client?.parentElement)

    expect(
      screen.getByRole("link", {
        name: "リラックマと遊園地 公式HPを新しいタブで開く",
      }),
    ).toHaveAttribute(
      "href",
      "https://www.san-x.co.jp/rilakkuma/theme_park_adventure/",
    )
    expect(
      screen.queryByRole("link", {
        name: "リラックマと遊園地 YouTubeを新しいタブで開く",
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: "リラックマと遊園地 の動画をモーダルで再生",
      }),
    ).toBeInTheDocument()
  })

  it("prepares YouTube API players behind thumbnail covers", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    const { container } = render(<FeaturedWorks />)

    const primary = getPrimarySegment(container)
    const preparingMedia = primary.querySelectorAll(
      '[data-featured-work-preview-media="preparing"]',
    )
    const thumbnailCovers = primary.querySelectorAll(
      '[data-featured-work-preview-thumbnail="visible"]',
    )

    expect(preparingMedia).toHaveLength(embeddedWorkCount + 1)
    expect(thumbnailCovers).toHaveLength(embeddedWorkCount + 1)

    for (const media of preparingMedia) {
      expect(media).toHaveClass("pointer-events-none")
      expect(media).toHaveClass("opacity-0")
    }

    for (const thumbnail of thumbnailCovers) {
      expect(thumbnail).toHaveClass("opacity-100")
    }
  })
})

describe("getFeaturedWorkMarqueeProgressBarGeometry", () => {
  const metrics = {
    start: 1200,
    loopWidth: 2400,
  }

  it("sizes the thumb from visible viewport width over one primary loop width", () => {
    const geometry = getFeaturedWorkMarqueeProgressBarGeometry({
      virtualScrollLeft: metrics.start,
      metrics,
      viewportWidth: 600,
      trackWidth: 1000,
      minThumbWidth: 44,
    })

    expect(geometry.progress).toBe(0)
    expect(geometry.thumbWidth).toBe(250)
    expect(geometry.thumbTranslateX).toBe(0)
  })

  it("maps one loop start-to-end progress across the full track travel", () => {
    const geometry = getFeaturedWorkMarqueeProgressBarGeometry({
      virtualScrollLeft: metrics.start + metrics.loopWidth * 0.999,
      metrics,
      viewportWidth: 600,
      trackWidth: 1000,
      minThumbWidth: 44,
    })

    expect(geometry.progress).toBeCloseTo(0.999, 3)
    expect(geometry.thumbWidth).toBe(250)
    expect(geometry.thumbTranslateX).toBeCloseTo(749.25, 2)
  })

  it("wraps after a full loop back to the left edge", () => {
    const geometry = getFeaturedWorkMarqueeProgressBarGeometry({
      virtualScrollLeft: metrics.start + metrics.loopWidth,
      metrics,
      viewportWidth: 600,
      trackWidth: 1000,
      minThumbWidth: 44,
    })

    expect(geometry.progress).toBe(0)
    expect(geometry.thumbTranslateX).toBe(0)
  })

  it("falls back to a left-edge minimum thumb when metrics are unavailable", () => {
    const geometry = getFeaturedWorkMarqueeProgressBarGeometry({
      virtualScrollLeft: 0,
      metrics: null,
      viewportWidth: 600,
      trackWidth: 1000,
      minThumbWidth: 44,
    })

    expect(geometry).toEqual({
      progress: 0,
      thumbWidth: 44,
      thumbTranslateX: 0,
    })
  })
})
