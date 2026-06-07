import { describe, expect, it } from "vitest"
import {
  FEATURED_PLAYLIST_WORKS,
  FEATURED_WORKS,
  LIVE_REEL_VIDEO_IDS,
  LIVE_REEL_VIDEOS,
  calculateClipWindow,
  getNextYouTubeThumbnailVariant,
  getYouTubeThumbnailUrl,
  shuffleVideoIds,
  shuffleYouTubeThumbnailVariants,
} from "@/components/hp/featured-works-data"

describe("featured works data", () => {
  it("defines the four official linked works with YouTube ids", () => {
    expect(FEATURED_WORKS).toEqual([
      expect.objectContaining({
        title: "火星の女王",
        officialUrl:
          "https://www.nhk.jp/g/ts/54KJPL1QGM/blog/bl/p987Er5pz4/bp/pYElk2QVvW/",
        links: [
          {
            label: "作品HP",
            url: "https://www.nhk.jp/g/ts/54KJPL1QGM/",
          },
          {
            label: "YouTube",
            url: "https://www.youtube.com/watch?v=IQb3beIbE1I",
          },
          {
            label: "ショット集1",
            url: "https://www.nhk.jp/g/ts/54KJPL1QGM/blog/bl/p987Er5pz4/bp/pYElk2QVvW/",
          },
          {
            label: "2",
            url: "https://www.nhk.jp/g/ts/54KJPL1QGM/blog/bl/p987Er5pz4/bp/pXy8Aa9ab2/",
          },
          {
            label: "3",
            url: "https://www.nhk.jp/g/ts/54KJPL1QGM/blog/bl/p987Er5pz4/bp/pZKwLbXAbZ/",
          },
        ],
      }),
      expect.objectContaining({
        title: "十角館の殺人 / 時計館の殺人",
        youtubeId: "-2kSMEiw0wA",
        officialUrl: "https://www.hulu.jp/static/tokeikannosatsujin/",
        links: [
          {
            label: "公式HP",
            url: "https://www.hulu.jp/static/tokeikannosatsujin/",
          },
          {
            label: "YouTube",
            url: "https://www.youtube.com/watch?v=-2kSMEiw0wA",
          },
        ],
      }),
      expect.objectContaining({
        title: "福山雅治ライブフィルム「言霊の幸わう夏」「月光」",
        youtubeId: "aiPpSEcNLTk",
        officialUrl: "https://www.fukuyamamasaharu-livefilm.com/gekko/",
        links: [
          {
            label: "公式HP",
            url: "https://www.fukuyamamasaharu-livefilm.com/gekko/",
          },
          {
            label: "YouTube",
            url: "https://www.youtube.com/watch?v=aiPpSEcNLTk",
          },
        ],
      }),
      expect.objectContaining({
        title: "ゲキ×シネシリーズ",
        youtubeId: "GiqkQel2CeU",
        officialUrl: "https://www.geki-cine.jp/",
        links: [
          {
            label: "公式HP",
            url: "https://www.geki-cine.jp/",
          },
          {
            label: "YouTube",
            url: "https://www.youtube.com/watch?v=GiqkQel2CeU",
          },
        ],
      }),
    ])
    expect(FEATURED_WORKS[0]).not.toHaveProperty("youtubeId")
  })

  it("defines the live reel YouTube ids and fixed preview loops", () => {
    expect(LIVE_REEL_VIDEO_IDS).toEqual([
      "fEYJazIPxUg",
      "G_3xr5desOo",
      "ZorB-2mqe-U",
      "d7qo_ke4kqI",
      "Nhv9GDVem5U",
      "heb1yJtreJg",
      "peWya9bxVXc",
      "R92a65tojVg",
      "y0g6UCE0Pzg",
      "H_z2HYsx53o",
    ])
    expect(LIVE_REEL_VIDEOS).toEqual(
      expect.arrayContaining([
        { videoId: "peWya9bxVXc", loopStart: 10, loopEnd: 40 },
        { videoId: "R92a65tojVg", loopStart: 0, loopEnd: 30 },
        { videoId: "y0g6UCE0Pzg", loopStart: 50, loopEnd: 80 },
      ]),
    )
  })

  it("defines live, CM, and MV playlist cards", () => {
    expect(FEATURED_PLAYLIST_WORKS.map((work) => work.title)).toEqual([
      "ライブ映像作品",
      "CM",
      "MV",
    ])
    expect(FEATURED_PLAYLIST_WORKS[0]?.videos).toHaveLength(10)
    expect(FEATURED_PLAYLIST_WORKS[1]?.videos.map((video) => video.videoId)).toEqual([
      "Eo2IIH-w3h8",
      "fStjAoAOlbQ",
      "vchw9jvBntI",
      "cQwaCzcZNIk",
    ])
    expect(FEATURED_PLAYLIST_WORKS[2]?.videos.map((video) => video.videoId)).toEqual([
      "Pgvb6t2oLqg",
      "N7c7ZaVXjvk",
      "q5prKAR8UpA",
      "dbLARf2asG0",
      "QzQrzX07VMY",
      "EmjP3gJ_ALY",
      "6qZwQdw88Aw",
      "O8EynS4boVU",
    ])
  })

  it("shuffles ids without losing or adding entries", () => {
    const randomValues = [0.1, 0.7, 0.2, 0.9]
    const shuffled = shuffleVideoIds(LIVE_REEL_VIDEO_IDS, () => randomValues.shift() ?? 0)

    expect(shuffled).toHaveLength(LIVE_REEL_VIDEO_IDS.length)
    expect(new Set(shuffled)).toEqual(new Set(LIVE_REEL_VIDEO_IDS))
    expect(shuffled).not.toEqual(LIVE_REEL_VIDEO_IDS)
  })

  it("builds YouTube thumbnail URLs for generated hq frames and default fallback", () => {
    expect(getYouTubeThumbnailUrl("-2kSMEiw0wA", 1)).toBe(
      "https://i.ytimg.com/vi/-2kSMEiw0wA/hq1.jpg",
    )
    expect(getYouTubeThumbnailUrl("-2kSMEiw0wA", 2)).toBe(
      "https://i.ytimg.com/vi/-2kSMEiw0wA/hq2.jpg",
    )
    expect(getYouTubeThumbnailUrl("-2kSMEiw0wA", 3)).toBe(
      "https://i.ytimg.com/vi/-2kSMEiw0wA/hq3.jpg",
    )
    expect(getYouTubeThumbnailUrl("-2kSMEiw0wA")).toBe(
      "https://i.ytimg.com/vi/-2kSMEiw0wA/hqdefault.jpg",
    )
  })

  it("cycles thumbnail variants in shuffled rounds without immediate order repeats", () => {
    const firstOrder = shuffleYouTubeThumbnailVariants([], () => 0.99)
    const secondOrder = shuffleYouTubeThumbnailVariants(firstOrder, () => 0.99)

    expect(firstOrder).toEqual([1, 2, 3])
    expect(secondOrder).toEqual([2, 3, 1])
  })

  it("deals one thumbnail variant per cover display and reshuffles after three", () => {
    let state = getNextYouTubeThumbnailVariant(undefined, () => 0.99)

    expect(state.variant).toBe(1)
    state = getNextYouTubeThumbnailVariant(state, () => 0.99)
    expect(state.variant).toBe(2)
    state = getNextYouTubeThumbnailVariant(state, () => 0.99)
    expect(state.variant).toBe(3)
    state = getNextYouTubeThumbnailVariant(state, () => 0.99)
    expect(state.variant).toBe(2)
  })

  it("uses the full duration for videos up to 30 seconds", () => {
    expect(calculateClipWindow(24.5, () => 0.9)).toEqual({
      startSeconds: 0,
      playSeconds: 24.5,
    })
  })

  it("selects a random 30 second window for longer videos", () => {
    expect(calculateClipWindow(90, () => 0.5)).toEqual({
      startSeconds: 30,
      playSeconds: 30,
    })
  })
})
