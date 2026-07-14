// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  FEATURED_PLAYLIST_WORKS,
  FEATURED_WORKS,
  LIVE_REEL_VIDEO_IDS,
} from "@/components/hp/featured-works-data"
import {
  FeaturedWorks,
  getFeaturedWorkMarqueeProgressBarGeometry,
  getPreviewClipWindow,
  getYouTubePlayerVars,
} from "@/components/hp/featured-works"
import { HP_MODAL_OVERLAY_Z_INDEX } from "@/components/hp/modal-layer"

describe("FeaturedWorks", () => {
  const embeddedWorkCount = FEATURED_WORKS.filter((work) => work.youtubeId).length
  const playlistWorkCount = FEATURED_PLAYLIST_WORKS.length
  const totalCardCount = FEATURED_WORKS.length + FEATURED_PLAYLIST_WORKS.length
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
    vi.unstubAllGlobals()
    vi.useRealTimers()
    delete window.YT
  })

  it("renders non-navigating work cards with only badge links", () => {
    const { container } = render(<FeaturedWorks />)
    const primary = getPrimarySegment(container)
    const primaryQueries = within(primary)

    for (const work of FEATURED_WORKS) {
      const card = primaryQueries.getByLabelText(`${work.title} 作品カード`)
      const cardQueries = within(card)
      expect(card).toBeInTheDocument()
      expect(card.tagName).toBe("DIV")
      expect(card).not.toHaveAttribute("href")

      const visibleLinks = work.youtubeId
        ? work.links.filter((link) => link.label !== "YouTube")
        : work.links

      for (const link of visibleLinks) {
        const badge = cardQueries.getByRole("link", {
          name: `${work.title} ${link.label}を新しいタブで開く`,
        })
        expect(badge).toHaveAttribute("href", link.url)
        expect(badge).toHaveAttribute("target", "_blank")
        expect(badge).toHaveAttribute("rel", "noopener noreferrer")
      }

      if (work.youtubeId) {
        expect(
          cardQueries.queryByRole("link", {
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
    expect(progressTrack).not.toHaveAttribute("aria-hidden")
    expect(progressThumb).toHaveAttribute("role", "scrollbar")
    expect(progressThumb).toHaveAttribute("tabindex", "0")
    expect(progressThumb).toHaveAttribute(
      "aria-controls",
      viewport?.getAttribute("id"),
    )
    expect(progressThumb).toHaveAttribute("aria-orientation", "horizontal")
    expect(progressThumb).toHaveAttribute("aria-valuemin", "0")
    expect(progressThumb).toHaveAttribute("aria-valuemax", "1000")
    expect(progressThumb).not.toHaveAttribute("aria-hidden")
    expect(track).toHaveClass("w-max")
    expect(track).toHaveClass("gap-0")
    expect(track).not.toHaveClass("gap-4")
    expect(track).not.toHaveClass("md:gap-5")
    expect(track).toHaveClass("px-8")
    expect(track).not.toHaveClass("will-change-transform")
    expect(track?.textContent).toContain("火星の女王")
    expect(primary.querySelectorAll("[data-featured-work-card]")).toHaveLength(
      totalCardCount,
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
      totalCardCount,
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

  it("keeps preview and metadata independent from hover while using a transform spotlight", () => {
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
    const card = screen.getByLabelText("十角館の殺人 / 時計館の殺人 作品カード")
    const thumbnail = card.querySelector("[data-featured-work-preview-thumbnail]")
    const styles = container.querySelector("style")?.textContent

    expect(card).toHaveAttribute("data-featured-work-spotlight", "enabled")
    expect(card).not.toHaveClass("hover:-translate-y-0.5")
    expect(card.querySelector(".featured-work-card-meta")).toBeInTheDocument()
    expect(thumbnail).toHaveClass("transition-opacity")
    expect(styles).toContain("border-color 150ms var(--ease-out-strong)")
    expect(styles).toContain("transform: scale(0.985)")
    expect(styles).toContain(".featured-work-transparent-card::before")
    expect(styles).toContain("var(--hp-color-accent-focus-ring)")
    expect(styles).toContain("--featured-work-spotlight-x")

    fireEvent.pointerMove(card, { clientX: 120, clientY: 80 })
    expect(card).toHaveStyle("--featured-work-spotlight-x: 120px")
    expect(card).toHaveStyle("--featured-work-spotlight-y: 80px")
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

  it("lets the custom progress bar drag, jump, and drive keyboard scrolling", () => {
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
    const progressTrack = container.querySelector(
      '[data-featured-work-marquee-progress-track="true"]',
    ) as HTMLElement
    const progressThumb = container.querySelector(
      '[data-featured-work-marquee-progress-thumb="true"]',
    ) as HTMLElement
    const primaryStart = container.querySelector(
      '[data-featured-work-marquee-segment-start="primary"]',
    ) as HTMLElement
    const cloneAfterStart = container.querySelector(
      '[data-featured-work-marquee-segment-start="clone-after"]',
    ) as HTMLElement

    Object.defineProperty(viewport, "clientWidth", {
      configurable: true,
      value: 600,
    })
    Object.defineProperty(progressTrack, "clientWidth", {
      configurable: true,
      value: 1000,
    })
    Object.defineProperty(primaryStart, "offsetLeft", {
      configurable: true,
      value: 1000,
    })
    Object.defineProperty(cloneAfterStart, "offsetLeft", {
      configurable: true,
      value: 3400,
    })
    progressTrack.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 4,
      right: 1000,
      width: 1000,
      height: 4,
      toJSON: () => ({}),
    }))
    progressThumb.setPointerCapture = vi.fn()
    progressThumb.releasePointerCapture = vi.fn()

    fireEvent.pointerDown(progressThumb, {
      pointerId: 1,
      clientX: 100,
    })
    fireEvent.pointerMove(progressThumb, {
      pointerId: 1,
      clientX: 250,
    })
    expect(viewport.scrollLeft).toBe(1480)
    expect(progressThumb).toHaveAttribute(
      "data-featured-work-marquee-progress",
      "0.2000",
    )
    expect(progressThumb).toHaveAttribute("aria-valuenow", "200")
    expect(viewport).toHaveAttribute("data-featured-work-marquee-state", "paused")
    fireEvent.pointerUp(progressThumb, {
      pointerId: 1,
      clientX: 250,
    })

    fireEvent.pointerDown(progressTrack, {
      pointerId: 2,
      clientX: 500,
    })
    expect(viewport.scrollLeft).toBe(2200)
    expect(progressThumb).toHaveAttribute(
      "data-featured-work-marquee-progress",
      "0.5000",
    )

    fireEvent.keyDown(progressThumb, { key: "ArrowRight" })
    expect(viewport.scrollLeft).toBe(2440)

    fireEvent.keyDown(progressThumb, { key: "Home" })
    expect(viewport.scrollLeft).toBe(1000)

    fireEvent.keyDown(progressThumb, { key: "End" })
    expect(viewport.scrollLeft).toBe(3399)
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

  it("renders playlist cards without badge links", () => {
    render(<FeaturedWorks />)

    for (const work of FEATURED_PLAYLIST_WORKS) {
      expect(screen.getByLabelText(`${work.title}のランダムループ再生カード`)).toBeInTheDocument()
      expect(screen.queryByRole("link", { name: new RegExp(work.title) })).not.toBeInTheDocument()
    }
    expect(screen.queryByText("ライブ映像作品多数")).not.toBeInTheDocument()
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
      "bg-[rgba(8,4,24,0.42)]",
      "p-4",
      "md:p-8",
    )
    expect(dialog.parentElement).toHaveStyle({
      zIndex: String(HP_MODAL_OVERLAY_Z_INDEX),
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

  it("renders eight cards with live, CM, and MV playlist counts", () => {
    const { container } = render(<FeaturedWorks />)
    const primary = getPrimarySegment(container)
    const cards = primary.querySelectorAll("[data-featured-work-card]")

    expect(Array.from(cards).map((card) => card.getAttribute("data-featured-work-card"))).toEqual([
      "火星の女王",
      "十角館の殺人 / 時計館の殺人",
      "福山雅治ライブフィルム「言霊の幸わう夏」「月光」",
      "ゲキ×シネシリーズ",
      "リラックマと遊園地",
      "ライブ映像作品",
      "CM",
      "MV",
    ])

    for (const work of FEATURED_PLAYLIST_WORKS) {
      const card = screen.getByLabelText(`${work.title}のランダムループ再生カード`)
      expect(card).toHaveAttribute(
        "data-featured-work-playlist-video-count",
        String(work.videos.length),
      )
      expect(card).toHaveAttribute(
        "data-featured-work-playlist-video-ids",
        work.videos.map((video) => video.videoId).join(","),
      )
      expect(
        screen.getByRole("button", {
          name: `${work.title}をモーダルで再生`,
        }),
      ).toBeInTheDocument()
    }
  })

  it("passes fixed live preview loop windows to the YouTube player vars", () => {
    const fixedLoop = FEATURED_PLAYLIST_WORKS[0]?.videos.find(
      (video) => video.videoId === "peWya9bxVXc",
    )
    expect(fixedLoop).toEqual({
      videoId: "peWya9bxVXc",
      loopStart: 10,
      loopEnd: 40,
    })
    expect(getYouTubePlayerVars(fixedLoop)).toMatchObject({
      loop: 1,
      playlist: "peWya9bxVXc",
      start: 10,
      end: 40,
    })
    expect(getYouTubePlayerVars("heb1yJtreJg")).not.toHaveProperty("start")
  })

  it("selects preview clips with fixed loops before constrained or random windows", () => {
    expect(
      getPreviewClipWindow(
        {
          videoId: "fixed",
          loopStart: 12,
          loopEnd: 42,
          clipRangeStart: 40,
          clipRangeEnd: 90,
        },
        90,
        () => 0.9,
      ),
    ).toEqual({
      startSeconds: 12,
      playSeconds: 30,
    })
    expect(getPreviewClipWindow({ videoId: "short" }, 24.5, () => 0.9)).toEqual({
      startSeconds: 0,
      playSeconds: 24.5,
    })
    expect(
      getPreviewClipWindow(
        { videoId: "range", clipRangeStart: 33, clipRangeEnd: 93 },
        120,
        () => 0.5,
      ),
    ).toEqual({
      startSeconds: 48,
      playSeconds: 30,
    })
    expect(
      getPreviewClipWindow(
        { videoId: "exclude", clipExcludeStart: 20, clipExcludeEnd: 60 },
        120,
        () => 0.9,
      ),
    ).toEqual({
      startSeconds: 87,
      playSeconds: 30,
    })
    expect(getPreviewClipWindow({ videoId: "random" }, 90, () => 0.5)).toEqual({
      startSeconds: 30,
      playSeconds: 30,
    })
  })

  it("keeps single video cards free of preview clip constraints", async () => {
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

    for (const work of FEATURED_WORKS.filter((item) => item.youtubeId)) {
      const card = screen.getByLabelText(`${work.title} 作品カード`)
      await waitFor(() => {
        expect(card.querySelector("[data-featured-work-current-video-id]")).toBeInTheDocument()
      })
      const media = card.querySelector("[data-featured-work-current-video-id]")
      expect(media).not.toHaveAttribute("data-featured-work-loop-start")
      expect(media).not.toHaveAttribute("data-featured-work-loop-end")
      expect(media).not.toHaveAttribute("data-featured-work-clip-range-start")
      expect(media).not.toHaveAttribute("data-featured-work-clip-exclude-start")
    }
  })

  it("drives single video cards with full video loops instead of random 30 second clips", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    vi.spyOn(Math, "random").mockReturnValue(0.5)

    type MockPlayerOptions = {
      videoId?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: (event: { target: MockPlayer }) => void
        onStateChange?: (event: { data: number; target: MockPlayer }) => void
        onError?: (event: { data: number; target: MockPlayer }) => void
      }
    }

    const players: MockPlayer[] = []

    class MockPlayer {
      readonly options: MockPlayerOptions
      readonly mute = vi.fn()
      readonly stopVideo = vi.fn()
      readonly destroy = vi.fn()
      readonly getDuration = vi.fn(() => 90)
      readonly seekTo = vi.fn()
      readonly loadVideoById = vi.fn()
      readonly playVideo = vi.fn(() => {
        this.options.events?.onStateChange?.({ data: 1, target: this })
      })

      constructor(_element: HTMLElement, options: MockPlayerOptions) {
        this.options = options
        players.push(this)
        queueMicrotask(() => {
          options.events?.onReady?.({ target: this })
        })
      }
    }

    window.YT = {
      Player: MockPlayer,
      PlayerState: {
        ENDED: 0,
        PLAYING: 1,
      },
    }

    render(<FeaturedWorks />)

    await waitFor(() => {
      const player = players.find(
        (item) => item.options.videoId === "-2kSMEiw0wA",
      )
      expect(player).toBeDefined()
      expect(player?.options.playerVars).toMatchObject({
        loop: 1,
        playlist: "-2kSMEiw0wA",
      })
      expect(player?.seekTo).not.toHaveBeenCalled()
    })

    const player = players.find(
      (item) => item.options.videoId === "-2kSMEiw0wA",
    )

    const card = screen.getByLabelText("十角館の殺人 / 時計館の殺人 作品カード")
    const media = card.querySelector(
      '[data-featured-work-current-video-id="-2kSMEiw0wA"]',
    )
    expect(media).toHaveAttribute("data-featured-work-clip-start", "0")
    expect(media).toHaveAttribute("data-featured-work-clip-seconds", "90")

    player?.options.events?.onStateChange?.({ data: 0, target: player })

    expect(player?.seekTo).toHaveBeenCalledTimes(1)
    expect(player?.seekTo).toHaveBeenLastCalledWith(0, true)
  })

  it("keeps startup thumbnail covers visible for 5 seconds after playback starts", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0)

    type MockPlayerOptions = {
      videoId?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: (event: { target: MockPlayer }) => void
        onStateChange?: (event: { data: number; target: MockPlayer }) => void
        onError?: (event: { data: number; target: MockPlayer }) => void
      }
    }

    const players: MockPlayer[] = []

    class MockPlayer {
      readonly options: MockPlayerOptions
      readonly mute = vi.fn()
      readonly stopVideo = vi.fn()
      readonly destroy = vi.fn()
      readonly getDuration = vi.fn(() => 90)
      readonly seekTo = vi.fn()
      readonly loadVideoById = vi.fn()
      readonly playVideo = vi.fn(() => {
        this.options.events?.onStateChange?.({ data: 1, target: this })
      })

      constructor(_element: HTMLElement, options: MockPlayerOptions) {
        this.options = options
        players.push(this)
        queueMicrotask(() => {
          options.events?.onReady?.({ target: this })
        })
      }
    }

    window.YT = {
      Player: MockPlayer,
      PlayerState: {
        ENDED: 0,
        PLAYING: 1,
      },
    }

    render(<FeaturedWorks />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(players.length).toBeGreaterThanOrEqual(
      embeddedWorkCount + playlistWorkCount,
    )

    const previewLabels = [
      ...FEATURED_WORKS.filter((work) => work.youtubeId).map(
        (work) => `${work.title} 作品カード`,
      ),
      ...FEATURED_PLAYLIST_WORKS.map(
        (work) => `${work.title}のランダムループ再生カード`,
      ),
    ]

    const expectCovers = (state: "preparing" | "playing") => {
      for (const label of previewLabels) {
        const card = screen.getByLabelText(label)
        expect(
          card.querySelector(`[data-featured-work-preview-media="${state}"]`),
        ).toBeInTheDocument()
        expect(
          card.querySelector(
            `[data-featured-work-preview-thumbnail="${
              state === "preparing" ? "visible" : "hidden"
            }"]`,
          ),
        ).toBeInTheDocument()
      }
    }

    expectCovers("preparing")

    await act(async () => {
      vi.advanceTimersByTime(4999)
    })
    expectCovers("preparing")

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expectCovers("playing")
  })

  it("counts the first startup cover hold from the first playback start", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0)
    const setTimeoutSpy = vi.spyOn(window, "setTimeout")

    type MockPlayerOptions = {
      videoId?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: (event: { target: MockPlayer }) => void
        onStateChange?: (event: { data: number; target: MockPlayer }) => void
        onError?: (event: { data: number; target: MockPlayer }) => void
      }
    }

    const players: MockPlayer[] = []

    class MockPlayer {
      readonly options: MockPlayerOptions
      readonly mute = vi.fn()
      readonly stopVideo = vi.fn()
      readonly destroy = vi.fn()
      readonly getDuration = vi.fn(() => 90)
      readonly seekTo = vi.fn()
      readonly loadVideoById = vi.fn()
      readonly playVideo = vi.fn(() => {
        this.options.events?.onStateChange?.({ data: 1, target: this })
      })

      constructor(_element: HTMLElement, options: MockPlayerOptions) {
        this.options = options
        players.push(this)
      }
    }

    window.YT = {
      Player: MockPlayer,
      PlayerState: {
        ENDED: 0,
        PLAYING: 1,
      },
    }

    render(<FeaturedWorks />)

    await act(async () => {
      await Promise.resolve()
    })

    const player = players.find(
      (item) => item.options.videoId === "-2kSMEiw0wA",
    )
    expect(player).toBeDefined()
    const card = screen.getByLabelText("十角館の殺人 / 時計館の殺人 作品カード")

    await act(async () => {
      vi.advanceTimersByTime(4500)
      player?.options.events?.onReady?.({ target: player })
      await Promise.resolve()
    })

    expect(
      card.querySelector('[data-featured-work-preview-media="preparing"]'),
    ).toBeInTheDocument()
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
  })

  it("limits YouTube player creation to marquee cards near the viewport", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    const observers: MockIntersectionObserver[] = []

    class MockIntersectionObserver implements IntersectionObserver {
      readonly root: Element | Document | null
      readonly rootMargin: string
      readonly thresholds: ReadonlyArray<number>
      readonly elements: Element[] = []

      constructor(
        private readonly callback: IntersectionObserverCallback,
        options: IntersectionObserverInit = {},
      ) {
        this.root = options.root ?? null
        this.rootMargin = options.rootMargin ?? "0px"
        this.thresholds = Array.isArray(options.threshold)
          ? options.threshold
          : [options.threshold ?? 0]
        observers.push(this)
      }

      observe = (element: Element) => {
        this.elements.push(element)
      }

      unobserve = (element: Element) => {
        const index = this.elements.indexOf(element)
        if (index >= 0) {
          this.elements.splice(index, 1)
        }
      }

      disconnect = () => {
        this.elements.length = 0
      }

      takeRecords = () => []

      emit(element: Element, isIntersecting: boolean) {
        this.callback(
          [
            {
              isIntersecting,
              target: element,
            } as IntersectionObserverEntry,
          ],
          this,
        )
      }
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver)

    type MockPlayerOptions = {
      videoId?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: (event: { target: MockPlayer }) => void
        onStateChange?: (event: { data: number; target: MockPlayer }) => void
        onError?: (event: { data: number; target: MockPlayer }) => void
      }
    }

    const players: MockPlayer[] = []

    class MockPlayer {
      readonly options: MockPlayerOptions
      readonly mute = vi.fn()
      readonly stopVideo = vi.fn()
      readonly destroy = vi.fn()
      readonly getDuration = vi.fn(() => 90)
      readonly seekTo = vi.fn()
      readonly loadVideoById = vi.fn()
      readonly playVideo = vi.fn()

      constructor(_element: HTMLElement, options: MockPlayerOptions) {
        this.options = options
        players.push(this)
      }
    }

    window.YT = {
      Player: MockPlayer,
      PlayerState: {
        ENDED: 0,
        PLAYING: 1,
      },
    }

    const { container } = render(<FeaturedWorks />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(players).toHaveLength(0)

    const viewport = container.querySelector(
      '[data-featured-work-marquee-viewport="true"]',
    ) as HTMLElement
    const sectionObserver = observers.find((observer) => observer.root === null)
    expect(sectionObserver).toBeDefined()

    await act(async () => {
      sectionObserver?.emit(viewport, true)
      await Promise.resolve()
    })

    expect(players).toHaveLength(0)

    const firstVideoCard = screen.getByLabelText(
      "十角館の殺人 / 時計館の殺人 作品カード",
    )
    const firstCardObserver = observers.find(
      (observer) =>
        observer.root === viewport &&
        observer.elements.includes(firstVideoCard),
    )
    expect(firstCardObserver?.rootMargin).toBe("0px 320px")

    await act(async () => {
      firstCardObserver?.emit(firstVideoCard, true)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(players).toHaveLength(1)
    })
    expect(players[0]?.options.videoId).toBe("-2kSMEiw0wA")
    expect(
      container.querySelectorAll("[data-featured-work-preview-media]"),
    ).toHaveLength(1)
  })

  it("tears down pre-ready YouTube players safely when marquee cards leave the near viewport", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    const observers: MockIntersectionObserver[] = []

    class MockIntersectionObserver implements IntersectionObserver {
      readonly root: Element | Document | null
      readonly rootMargin: string
      readonly thresholds: ReadonlyArray<number>
      readonly elements: Element[] = []

      constructor(
        private readonly callback: IntersectionObserverCallback,
        options: IntersectionObserverInit = {},
      ) {
        this.root = options.root ?? null
        this.rootMargin = options.rootMargin ?? "0px"
        this.thresholds = Array.isArray(options.threshold)
          ? options.threshold
          : [options.threshold ?? 0]
        observers.push(this)
      }

      observe = (element: Element) => {
        this.elements.push(element)
      }

      unobserve = (element: Element) => {
        const index = this.elements.indexOf(element)
        if (index >= 0) {
          this.elements.splice(index, 1)
        }
      }

      disconnect = () => {
        this.elements.length = 0
      }

      takeRecords = () => []

      emit(element: Element, isIntersecting: boolean) {
        this.callback(
          [
            {
              isIntersecting,
              target: element,
            } as IntersectionObserverEntry,
          ],
          this,
        )
      }
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver)

    type MockPlayerOptions = {
      videoId?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: (event: { target: MockPendingPlayer }) => void
        onStateChange?: (event: { data: number; target: MockPendingPlayer }) => void
        onError?: (event: { data: number; target: MockPendingPlayer }) => void
      }
    }

    const players: MockPendingPlayer[] = []

    class MockPendingPlayer {
      readonly element: HTMLElement
      readonly options: MockPlayerOptions
      mute?: () => void
      stopVideo?: () => void
      destroy?: () => void
      getDuration?: () => number
      seekTo?: (seconds: number, allowSeekAhead: boolean) => void
      loadVideoById?: (videoId: string | { videoId: string; startSeconds?: number; endSeconds?: number }) => void
      playVideo?: () => void

      constructor(element: HTMLElement, options: MockPlayerOptions) {
        this.element = element
        this.options = options
        element.appendChild(document.createElement("iframe"))
        players.push(this)
      }

      makeReady() {
        this.mute = vi.fn()
        this.stopVideo = vi.fn()
        this.destroy = vi.fn(() => {
          this.element.replaceChildren()
        })
        this.getDuration = vi.fn(() => 90)
        this.seekTo = vi.fn()
        this.loadVideoById = vi.fn()
        this.playVideo = vi.fn()
        this.options.events?.onReady?.({ target: this })
      }
    }

    window.YT = {
      Player: MockPendingPlayer as unknown as NonNullable<Window["YT"]>["Player"],
      PlayerState: {
        ENDED: 0,
        PLAYING: 1,
      },
    }

    const { container } = render(<FeaturedWorks />)
    await act(async () => {
      await Promise.resolve()
    })

    const viewport = container.querySelector(
      '[data-featured-work-marquee-viewport="true"]',
    ) as HTMLElement
    const sectionObserver = observers.find((observer) => observer.root === null)
    expect(sectionObserver).toBeDefined()

    await act(async () => {
      sectionObserver?.emit(viewport, true)
      await Promise.resolve()
    })

    const singleCard = screen.getByLabelText(
      "十角館の殺人 / 時計館の殺人 作品カード",
    )
    const playlistCard = screen.getByLabelText(
      "ライブ映像作品のランダムループ再生カード",
    )
    const singleObserver = observers.find(
      (observer) =>
        observer.root === viewport && observer.elements.includes(singleCard),
    )
    const playlistObserver = observers.find(
      (observer) =>
        observer.root === viewport && observer.elements.includes(playlistCard),
    )
    expect(singleObserver).toBeDefined()
    expect(playlistObserver).toBeDefined()

    await act(async () => {
      singleObserver?.emit(singleCard, true)
      playlistObserver?.emit(playlistCard, true)
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(players).toHaveLength(2)
    })
    expect(players.every((player) => typeof player.stopVideo === "undefined")).toBe(true)
    expect(players.every((player) => typeof player.destroy === "undefined")).toBe(true)

    await act(async () => {
      singleObserver?.emit(singleCard, false)
      playlistObserver?.emit(playlistCard, false)
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      for (const player of players) {
        player.makeReady()
      }
      await Promise.resolve()
    })

    for (const player of players) {
      expect(player.destroy).toHaveBeenCalledTimes(1)
      expect(player.element.querySelector("iframe")).not.toBeInTheDocument()
      expect(player.playVideo).not.toHaveBeenCalled()
    }
  })

  it("re-shows single video thumbnail covers before each full video loop restart", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0.5)

    const observers: MockIntersectionObserver[] = []

    class MockIntersectionObserver implements IntersectionObserver {
      readonly root: Element | Document | null
      readonly rootMargin: string
      readonly thresholds: ReadonlyArray<number>
      readonly elements: Element[] = []

      constructor(
        private readonly callback: IntersectionObserverCallback,
        options: IntersectionObserverInit = {},
      ) {
        this.root = options.root ?? null
        this.rootMargin = options.rootMargin ?? "0px"
        this.thresholds = Array.isArray(options.threshold)
          ? options.threshold
          : [options.threshold ?? 0]
        observers.push(this)
      }

      observe = (element: Element) => {
        this.elements.push(element)
      }

      unobserve = (element: Element) => {
        const index = this.elements.indexOf(element)
        if (index >= 0) {
          this.elements.splice(index, 1)
        }
      }

      disconnect = () => {
        this.elements.length = 0
      }

      takeRecords = () => []

      emit(element: Element, isIntersecting: boolean) {
        this.callback(
          [
            {
              isIntersecting,
              target: element,
            } as IntersectionObserverEntry,
          ],
          this,
        )
      }
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver)

    type MockPlayerOptions = {
      videoId?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: (event: { target: MockPlayer }) => void
        onStateChange?: (event: { data: number; target: MockPlayer }) => void
        onError?: (event: { data: number; target: MockPlayer }) => void
      }
    }

    const players: MockPlayer[] = []

    class MockPlayer {
      readonly element: HTMLElement
      readonly options: MockPlayerOptions
      readonly mute = vi.fn()
      readonly stopVideo = vi.fn()
      readonly destroy = vi.fn()
      readonly getDuration = vi.fn(() => 90)
      readonly seekTo = vi.fn()
      readonly loadVideoById = vi.fn()
      readonly playVideo = vi.fn(() => {
        this.options.events?.onStateChange?.({ data: 1, target: this })
      })

      constructor(element: HTMLElement, options: MockPlayerOptions) {
        this.element = element
        this.options = options
        players.push(this)
        queueMicrotask(() => {
          options.events?.onReady?.({ target: this })
        })
      }
    }

    window.YT = {
      Player: MockPlayer,
      PlayerState: {
        ENDED: 0,
        PLAYING: 1,
      },
    }

    const { container } = render(<FeaturedWorks />)

    await act(async () => {
      await Promise.resolve()
    })

    const viewport = container.querySelector(
      '[data-featured-work-marquee-viewport="true"]',
    ) as HTMLElement
    const sectionObserver = observers.find((observer) => observer.root === null)
    expect(sectionObserver).toBeDefined()

    await act(async () => {
      sectionObserver?.emit(viewport, true)
      await Promise.resolve()
    })

    const singleCard = screen.getByLabelText(
      "十角館の殺人 / 時計館の殺人 作品カード",
    )
    const singleObserver = observers.find(
      (observer) =>
        observer.root === viewport && observer.elements.includes(singleCard),
    )
    expect(singleObserver).toBeDefined()

    await act(async () => {
      singleObserver?.emit(singleCard, true)
      await Promise.resolve()
      await Promise.resolve()
    })

    const player = players.find(
      (item) => item.options.videoId === "-2kSMEiw0wA",
    )
    expect(player).toBeDefined()
    const card = player?.element.closest(
      '[data-featured-work-card="十角館の殺人 / 時計館の殺人"]',
    ) as HTMLElement | null
    expect(card).toBeInTheDocument()

    const getSingleThumbnail = () => {
      const thumbnail = card?.querySelector<HTMLImageElement>(
        "[data-featured-work-preview-thumbnail]",
      )
      expect(thumbnail).toBeInTheDocument()
      return thumbnail as HTMLImageElement
    }
    const expectSingleCover = (state: "preparing" | "playing") => {
      expect(
        card?.querySelector('[data-featured-work-current-video-id="-2kSMEiw0wA"]'),
      ).toHaveAttribute("data-featured-work-preview-media", state)
      expect(
        card?.querySelector(
          `[data-featured-work-preview-thumbnail="${
            state === "preparing" ? "visible" : "hidden"
          }"]`,
        ),
      ).toBeInTheDocument()
    }

    expectSingleCover("preparing")
    const firstThumbnail = getSingleThumbnail()
    const firstThumbnailSrc = firstThumbnail.getAttribute("src")
    expect(firstThumbnailSrc).toMatch(
      /^https:\/\/i\.ytimg\.com\/vi\/-2kSMEiw0wA\/hq[123]\.jpg$/,
    )

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expectSingleCover("playing")

    act(() => {
      player?.options.events?.onStateChange?.({ data: 0, target: player })
    })
    expectSingleCover("preparing")
    expect(player?.seekTo).toHaveBeenCalledTimes(1)
    expect(player?.seekTo).toHaveBeenLastCalledWith(0, true)
    await act(async () => {
      await Promise.resolve()
    })
    const secondThumbnailSrc = getSingleThumbnail().getAttribute("src")
    expect(secondThumbnailSrc).toMatch(
      /^https:\/\/i\.ytimg\.com\/vi\/-2kSMEiw0wA\/hq[123]\.jpg$/,
    )
    expect(firstThumbnailSrc).toMatch(
      /^https:\/\/i\.ytimg\.com\/vi\/-2kSMEiw0wA\/hq[123]\.jpg$/,
    )

    act(() => {
      vi.advanceTimersByTime(4999)
    })
    expectSingleCover("preparing")

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expectSingleCover("playing")
  })

  it("falls back to hqdefault when a generated thumbnail frame is missing", () => {
    const { container } = render(<FeaturedWorks />)
    const primary = getPrimarySegment(container)
    const thumbnail = primary.querySelector<HTMLImageElement>(
      '[data-featured-work-preview-thumbnail="visible"][src*="/hq"]',
    )

    expect(thumbnail).toBeInTheDocument()
    expect(thumbnail?.getAttribute("src")).toMatch(/\/hq[123]\.jpg$/)

    fireEvent.error(thumbnail as HTMLImageElement)

    expect(thumbnail?.getAttribute("src")).toMatch(/\/hqdefault\.jpg$/)
    expect(thumbnail).toHaveAttribute(
      "data-featured-work-preview-thumbnail-variant",
      "default",
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

    expect(previewFrames).toHaveLength(embeddedWorkCount + playlistWorkCount + 1)
    expect(abstractCovers).toHaveLength(1)
    expect(cropFrames).toHaveLength(0)
    expect(scaledMedia).toHaveLength(0)
    expect(thumbnailCovers).toHaveLength(embeddedWorkCount + playlistWorkCount)
    expect(mediaCovers).toHaveLength(embeddedWorkCount + playlistWorkCount)
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
    const liveReelCard = screen.getByLabelText("ライブ映像作品のランダムループ再生カード")
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
      const meta = title?.parentElement
      const metaRow = title?.nextElementSibling
      expect(title).toBeInTheDocument()
      expect(client).toBeInTheDocument()
      expect(meta).toHaveClass("featured-work-card-meta")
      expect(metaRow).toBe(client?.parentElement)
      expect(badges?.parentElement).toBe(client?.parentElement)
      expect(metaRow).toHaveClass("mt-3")
      expect(metaRow).toHaveClass("flex")
    }

    const primary = getPrimarySegment(container)
    const badgeGroups = primary.querySelectorAll("[data-featured-work-link-badges]")
    expect(badgeGroups).toHaveLength(FEATURED_WORKS.length)
    expect(
      screen
        .getByLabelText("ライブ映像作品のランダムループ再生カード")
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
    expect(abstractCover?.nextElementSibling).toBe(title?.parentElement)
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
      "公式ホームページ",
    ])

    const rows = badges?.querySelectorAll("[data-featured-work-link-badge-row]")
    expect(rows).toHaveLength(2)
    expect(rows?.[0]).toHaveAttribute("data-featured-work-link-badge-row", "top")
    expect(rows?.[1]).toHaveAttribute("data-featured-work-link-badge-row", "bottom")
    expect(
      Array.from(rows?.[0]?.querySelectorAll("[data-featured-work-link-badge]") ?? [])
        .map((badge) => badge.textContent),
    ).toEqual(["公式ホームページ"])
    expect(
      Array.from(rows?.[1]?.querySelectorAll("[data-featured-work-link-badge]") ?? [])
        .map((badge) => badge.textContent),
    ).toEqual([])

    expect(
      getPrimarySegment(container).querySelectorAll(
        '[data-featured-work-abstract-cover="true"]',
      ),
    ).toHaveLength(1)
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

    expect(preparingMedia).toHaveLength(embeddedWorkCount + playlistWorkCount)
    expect(thumbnailCovers).toHaveLength(embeddedWorkCount + playlistWorkCount)

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
