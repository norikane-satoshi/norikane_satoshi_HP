export type FeaturedWork = {
  title: string
  client: string
  youtubeId?: string
  loopStart?: number
  loopEnd?: number
  clipRangeStart?: number
  clipRangeEnd?: number
  clipExcludeStart?: number
  clipExcludeEnd?: number
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
  clipRangeStart?: number
  clipRangeEnd?: number
  clipExcludeStart?: number
  clipExcludeEnd?: number
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
      "https://www.web.nhk/tv/an/kaseinojoo/pl/series-tep-54KJPL1QGM",
    links: [
      {
        label: "公式ホームページ",
        url: "https://www.web.nhk/tv/an/kaseinojoo/pl/series-tep-54KJPL1QGM",
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
  {
    title: "リラックマと遊園地",
    client: "NETFLIX",
    youtubeId: "-X5BMqt0m2c",
    officialUrl: "https://www.san-x.co.jp/rilakkuma/theme_park_adventure/",
    links: [
      {
        label: "公式HP",
        url: "https://www.san-x.co.jp/rilakkuma/theme_park_adventure/",
      },
      {
        label: "YouTube",
        url: "https://www.youtube.com/watch?v=-X5BMqt0m2c",
      },
    ],
  },
]

export const LIVE_REEL_VIDEOS = [
  { videoId: "fEYJazIPxUg" },
  { videoId: "G_3xr5desOo" },
  { videoId: "ZorB-2mqe-U", clipExcludeStart: 367, clipExcludeEnd: 446 },
  { videoId: "d7qo_ke4kqI" },
  { videoId: "Nhv9GDVem5U", clipRangeStart: 0, clipRangeEnd: 291 },
  { videoId: "heb1yJtreJg", clipRangeStart: 33, clipRangeEnd: 265 },
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
      { videoId: "Eo2IIH-w3h8", clipRangeStart: 0, clipRangeEnd: 60 },
      { videoId: "fStjAoAOlbQ" },
      { videoId: "vchw9jvBntI", loopStart: 295, loopEnd: 325 },
      { videoId: "cQwaCzcZNIk" },
    ],
  },
  {
    title: "MV",
    videos: [
      { videoId: "Pgvb6t2oLqg", clipRangeStart: 0, clipRangeEnd: 244 },
      { videoId: "N7c7ZaVXjvk", clipRangeStart: 0, clipRangeEnd: 205 },
      { videoId: "q5prKAR8UpA" },
      { videoId: "dbLARf2asG0" },
      { videoId: "QzQrzX07VMY" },
      { videoId: "EmjP3gJ_ALY" },
      { videoId: "6qZwQdw88Aw" },
      { videoId: "O8EynS4boVU", clipRangeStart: 0, clipRangeEnd: 165 },
    ],
  },
]

export type ClipWindow = {
  startSeconds: number
  playSeconds: number
}

export type ClipWindowConstraint = Pick<
  FeaturedWorkPreviewVideo,
  "clipRangeStart" | "clipRangeEnd" | "clipExcludeStart" | "clipExcludeEnd"
>

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getFiniteSeconds(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function getRandomStart(
  minStart: number,
  maxStart: number,
  random: () => number,
) {
  if (maxStart <= minStart) {
    return minStart
  }

  return clamp(
    Math.floor(random() * (maxStart - minStart + 1)) + minStart,
    minStart,
    maxStart,
  )
}

function getRangeClipWindow(
  durationSeconds: number,
  random: () => number,
  maxPlaySeconds: number,
  constraint: ClipWindowConstraint,
): ClipWindow | null {
  const rangeStart = getFiniteSeconds(constraint.clipRangeStart)
  const rangeEnd = getFiniteSeconds(constraint.clipRangeEnd)
  if (rangeStart === null || rangeEnd === null || rangeEnd <= rangeStart) {
    return null
  }

  const clampedStart = clamp(rangeStart, 0, durationSeconds)
  const clampedEnd = clamp(rangeEnd, 0, durationSeconds)
  if (clampedEnd <= clampedStart) {
    return null
  }

  const rangeDuration = clampedEnd - clampedStart
  const maxStart = Math.max(0, durationSeconds - maxPlaySeconds)
  if (rangeDuration <= maxPlaySeconds) {
    const startSeconds = clamp(clampedStart, 0, maxStart)
    return {
      startSeconds,
      playSeconds: Math.min(rangeDuration, durationSeconds - startSeconds),
    }
  }

  const maxRangeStart = Math.min(clampedEnd - maxPlaySeconds, maxStart)
  const minRangeStart = clamp(clampedStart, 0, maxRangeStart)
  return {
    startSeconds: getRandomStart(minRangeStart, maxRangeStart, random),
    playSeconds: maxPlaySeconds,
  }
}

function getExcludeClipWindow(
  durationSeconds: number,
  random: () => number,
  maxPlaySeconds: number,
  constraint: ClipWindowConstraint,
): ClipWindow | null {
  const excludeStart = getFiniteSeconds(constraint.clipExcludeStart)
  const excludeEnd = getFiniteSeconds(constraint.clipExcludeEnd)
  if (excludeStart === null || excludeEnd === null || excludeEnd <= excludeStart) {
    return null
  }

  const clampedExcludeStart = clamp(excludeStart, 0, durationSeconds)
  const clampedExcludeEnd = clamp(excludeEnd, 0, durationSeconds)
  if (clampedExcludeEnd <= clampedExcludeStart) {
    return null
  }

  const maxStart = Math.max(0, durationSeconds - maxPlaySeconds)
  const segments = [
    { start: 0, end: Math.min(maxStart, clampedExcludeStart - maxPlaySeconds) },
    { start: Math.max(0, clampedExcludeEnd), end: maxStart },
  ].filter((segment) => segment.end >= segment.start)

  if (segments.length === 0) {
    return null
  }

  const weightedSegments = segments.map((segment) => ({
    ...segment,
    weight: Math.max(0, segment.end - segment.start),
  }))
  const totalWeight = weightedSegments.reduce(
    (total, segment) => total + segment.weight,
    0,
  )

  if (totalWeight <= 0) {
    return {
      startSeconds: segments[0].start,
      playSeconds: maxPlaySeconds,
    }
  }

  let cursor = random() * totalWeight
  const selectedSegment =
    weightedSegments.find((segment) => {
      cursor -= segment.weight
      return cursor <= 0
    }) ?? weightedSegments[weightedSegments.length - 1]

  return {
    startSeconds: getRandomStart(
      selectedSegment.start,
      selectedSegment.end,
      random,
    ),
    playSeconds: maxPlaySeconds,
  }
}

export function calculateClipWindow(
  durationSeconds: number,
  random: () => number = Math.random,
  maxPlaySeconds = 30,
  constraint: ClipWindowConstraint = {},
): ClipWindow {
  const safeDuration = Number.isFinite(durationSeconds)
    ? Math.max(0, durationSeconds)
    : 0
  const safeMaxPlaySeconds = Number.isFinite(maxPlaySeconds)
    ? Math.max(0, maxPlaySeconds)
    : 30
  if (safeDuration <= safeMaxPlaySeconds) {
    return { startSeconds: 0, playSeconds: safeDuration }
  }

  const rangeClip = getRangeClipWindow(
    safeDuration,
    random,
    safeMaxPlaySeconds,
    constraint,
  )
  if (rangeClip) {
    return rangeClip
  }

  const excludeClip = getExcludeClipWindow(
    safeDuration,
    random,
    safeMaxPlaySeconds,
    constraint,
  )
  if (excludeClip) {
    return excludeClip
  }

  const maxStart = safeDuration - safeMaxPlaySeconds
  return {
    startSeconds: getRandomStart(0, maxStart, random),
    playSeconds: safeMaxPlaySeconds,
  }
}
