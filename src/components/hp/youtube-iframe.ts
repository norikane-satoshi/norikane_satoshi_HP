/* YouTube IFrame API の読み込みと、準備前のプレーヤーへ安全に命令するための共通部品。 */

export type YouTubePlayerStateChangeEvent = {
  data: number
  target: YouTubePlayer
}

export type YouTubePlayerErrorEvent = {
  data: number
  target: YouTubePlayer
}

export type YouTubePlayer = {
  mute?: () => void
  playVideo?: () => void
  pauseVideo?: () => void
  stopVideo?: () => void
  destroy?: () => void
  getDuration?: () => number
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void
  loadVideoById?: (
    videoId:
      | string
      | { videoId: string; startSeconds?: number; endSeconds?: number },
  ) => void
}

type YouTubePlayerConstructor = new (
  element: HTMLElement,
  options: {
    videoId?: string
    playerVars?: Record<string, string | number>
    events?: {
      onReady?: (event: { target: YouTubePlayer }) => void
      onStateChange?: (event: YouTubePlayerStateChangeEvent) => void
      onError?: (event: YouTubePlayerErrorEvent) => void
    }
  },
) => YouTubePlayer

declare global {
  interface Window {
    YT?: {
      Player: YouTubePlayerConstructor
      PlayerState: {
        ENDED: number
        PLAYING: number
      }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

/** 背景として音なし・操作なしで流すときの共通 playerVars。 */
export function getBackgroundPlayerVars() {
  return {
    autoplay: 1,
    controls: 0,
    disablekb: 1,
    fs: 0,
    iv_load_policy: 3,
    modestbranding: 1,
    mute: 1,
    origin: window.location.origin,
    playsinline: 1,
    rel: 0,
  }
}

let youtubeApiPromise: Promise<void> | null = null
const YOUTUBE_ORIGIN = "https://www.youtube.com"

export function loadYouTubeIframeApi() {
  if (typeof window === "undefined") {
    return Promise.resolve()
  }

  if (!document.querySelector(`link[rel="preconnect"][href="${YOUTUBE_ORIGIN}"]`)) {
    const preconnect = document.createElement("link")
    preconnect.rel = "preconnect"
    preconnect.href = YOUTUBE_ORIGIN
    preconnect.crossOrigin = "anonymous"
    document.head.appendChild(preconnect)
  }

  if (window.YT?.Player) {
    return Promise.resolve()
  }

  youtubeApiPromise ??= new Promise((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.()
      resolve()
    }

    if (!document.querySelector(`script[src="${YOUTUBE_ORIGIN}/iframe_api"]`)) {
      const script = document.createElement("script")
      script.src = `${YOUTUBE_ORIGIN}/iframe_api`
      script.async = true
      document.head.appendChild(script)
    }
  })

  return youtubeApiPromise
}

export function callReadyPlayerMethod(
  player: YouTubePlayer | null,
  isReady: boolean,
  method: Exclude<keyof YouTubePlayer, "getDuration">,
  ...args: unknown[]
) {
  if (!isReady || !player) {
    return false
  }

  const playerMethod = player[method]
  if (typeof playerMethod !== "function") {
    return false
  }

  try {
    ;(playerMethod as (...methodArgs: unknown[]) => unknown).apply(player, args)
    return true
  } catch {
    return false
  }
}

export function getReadyPlayerDuration(player: YouTubePlayer, isReady: boolean) {
  if (!isReady || typeof player.getDuration !== "function") {
    return 0
  }

  try {
    return player.getDuration()
  } catch {
    return 0
  }
}

export function stopAndDestroyPlayer(player: YouTubePlayer | null, isReady: boolean) {
  callReadyPlayerMethod(player, isReady, "stopVideo")
  callReadyPlayerMethod(player, isReady, "destroy")
}
