export type FeaturedWork = {
  title: string
  client: string
  youtubeId?: string
  loopStart?: number
  loopEnd?: number
  officialUrl: string
  links: FeaturedWorkLink[]
}

export type FeaturedWorkLink = {
  label: string
  url: string
}

export type FeaturedWorkPreviewVideo = {
  videoId: string
  loopStart?: number
  loopEnd?: number
}

export type FeaturedPlaylistWork = {
  title: string
  client?: string
  videos: readonly FeaturedWorkPreviewVideo[]
}

export const FEATURED_WORKS: FeaturedWork[] = [
  {
    title: "火星の女王",
    client: "NHK100周年記念ドラマ",
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
  },
  {
    title: "十角館の殺人 / 時計館の殺人",
    client: "hulu",
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
  },
  {
    title: "福山雅治ライブフィルム「言霊の幸わう夏」「月光」",
    client: "松竹配給",
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
  },
  {
    title: "ゲキ×シネシリーズ",
    client: "ヴィレッヂ",
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
  },
]

export const LIVE_REEL_VIDEOS = [
  { videoId: "fEYJazIPxUg" },
  { videoId: "G_3xr5desOo" },
  { videoId: "ZorB-2mqe-U" },
  { videoId: "d7qo_ke4kqI" },
  { videoId: "Nhv9GDVem5U" },
  { videoId: "heb1yJtreJg" },
  { videoId: "peWya9bxVXc", loopStart: 10, loopEnd: 40 },
  { videoId: "R92a65tojVg", loopStart: 0, loopEnd: 30 },
  { videoId: "y0g6UCE0Pzg", loopStart: 50, loopEnd: 80 },
  { videoId: "H_z2HYsx53o" },
] as const

export const LIVE_REEL_VIDEO_IDS = LIVE_REEL_VIDEOS.map((video) => video.videoId)

export const FEATURED_PLAYLIST_WORKS: FeaturedPlaylistWork[] = [
  {
    title: "ライブ映像作品",
    client: "配信",
    videos: LIVE_REEL_VIDEOS,
  },
  {
    title: "CM",
    videos: [
      { videoId: "Eo2IIH-w3h8" },
      { videoId: "fStjAoAOlbQ" },
      { videoId: "vchw9jvBntI" },
      { videoId: "cQwaCzcZNIk" },
    ],
  },
  {
    title: "MV",
    videos: [
      { videoId: "Pgvb6t2oLqg" },
      { videoId: "N7c7ZaVXjvk" },
      { videoId: "q5prKAR8UpA" },
      { videoId: "dbLARf2asG0" },
      { videoId: "QzQrzX07VMY" },
      { videoId: "EmjP3gJ_ALY" },
      { videoId: "6qZwQdw88Aw" },
      { videoId: "O8EynS4boVU" },
    ],
  },
]

export type ClipWindow = {
  startSeconds: number
  playSeconds: number
}

export const YOUTUBE_THUMBNAIL_VARIANTS = [1, 2, 3] as const

export type YouTubeThumbnailVariant =
  (typeof YOUTUBE_THUMBNAIL_VARIANTS)[number]

export type YouTubeThumbnailVariantSelection = {
  variant: YouTubeThumbnailVariant
  queue: YouTubeThumbnailVariant[]
  lastOrder: YouTubeThumbnailVariant[]
}

export function getYouTubeThumbnailUrl(
  videoId: string,
  variant: YouTubeThumbnailVariant | "default" = "default",
) {
  const fileName = variant === "default" ? "hqdefault" : `hq${variant}`
  return `https://i.ytimg.com/vi/${videoId}/${fileName}.jpg`
}

export function shuffleVideoIds<T>(
  videoIds: readonly T[],
  random: () => number = Math.random,
  prevLastItem?: T,
) {
  const shuffled = [...videoIds]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[swapIndex]
    shuffled[swapIndex] = current
  }
  if (
    prevLastItem !== undefined &&
    shuffled.length > 1 &&
    shuffled[0] === prevLastItem
  ) {
    const swapIndex = Math.floor(random() * (shuffled.length - 1)) + 1
    const current = shuffled[0]
    shuffled[0] = shuffled[swapIndex]
    shuffled[swapIndex] = current
  }
  return shuffled
}

function hasSameOrder<T>(left: readonly T[], right: readonly T[]) {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

export function shuffleYouTubeThumbnailVariants(
  previousOrder: readonly YouTubeThumbnailVariant[] = [],
  random: () => number = Math.random,
) {
  const shuffled = shuffleVideoIds(YOUTUBE_THUMBNAIL_VARIANTS, random)
  if (hasSameOrder(shuffled, previousOrder)) {
    return [...shuffled.slice(1), shuffled[0]]
  }
  return shuffled
}

export function getNextYouTubeThumbnailVariant(
  state?: Pick<YouTubeThumbnailVariantSelection, "queue" | "lastOrder">,
  random: () => number = Math.random,
): YouTubeThumbnailVariantSelection {
  const queue = state?.queue ?? []
  const lastOrder = state?.lastOrder ?? []
  if (queue.length === 0) {
    const nextOrder = shuffleYouTubeThumbnailVariants(lastOrder, random)
    const [variant, ...remainingQueue] = nextOrder
    return {
      variant,
      queue: remainingQueue,
      lastOrder: nextOrder,
    }
  }

  const [variant, ...remainingQueue] = queue
  return {
    variant,
    queue: remainingQueue,
    lastOrder,
  }
}

export function calculateClipWindow(
  durationSeconds: number,
  random: () => number = Math.random,
  maxPlaySeconds = 30,
): ClipWindow {
  const safeDuration = Math.max(0, durationSeconds)
  if (safeDuration <= maxPlaySeconds) {
    return { startSeconds: 0, playSeconds: safeDuration }
  }

  const maxStart = safeDuration - maxPlaySeconds
  return {
    startSeconds: Math.floor(random() * (maxStart + 1)),
    playSeconds: maxPlaySeconds,
  }
}
