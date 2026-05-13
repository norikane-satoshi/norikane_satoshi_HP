export type EmbedResolution =
  | { type: "tweet"; statusId: string }
  | {
      type: "iframe"
      src: string
      aspect: "video" | "auto"
      sandbox: string
      allow?: string
    }
  | { type: "fallback"; url: string; hostLabel: string }

const VIDEO_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
const MEDIA_SANDBOX = "allow-scripts allow-same-origin"
const APP_SANDBOX =
  "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"

function fallback(url: string, hostLabel?: string): EmbedResolution {
  return { type: "fallback", url, hostLabel: hostLabel || url }
}

function getYoutubeId(parsed: URL): string | null {
  const host = parsed.hostname.replace(/^www\./, "")
  if (host === "youtu.be") return parsed.pathname.split("/").filter(Boolean)[0] ?? null
  const paramId = parsed.searchParams.get("v")
  if (paramId) return paramId
  const [first, second] = parsed.pathname.split("/").filter(Boolean)
  if (first === "embed" || first === "shorts") return second ?? null
  return null
}

export function resolveEmbed(url: string): EmbedResolution {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return fallback(url)
  }

  const host = parsed.hostname.replace(/^www\./, "")
  const hostLabel = host || parsed.hostname

  switch (host) {
    case "x.com":
    case "twitter.com": {
      const statusId = parsed.pathname.match(/\/status\/(\d+)/)?.[1]
      return statusId ? { type: "tweet", statusId } : fallback(url, hostLabel)
    }
    case "youtube.com":
    case "m.youtube.com":
    case "youtu.be": {
      const id = getYoutubeId(parsed)
      return id
        ? {
            type: "iframe",
            src: `https://www.youtube.com/embed/${id}`,
            aspect: "video",
            sandbox: `${MEDIA_SANDBOX} allow-presentation`,
            allow: VIDEO_ALLOW,
          }
        : fallback(url, hostLabel)
    }
    case "vimeo.com":
    case "player.vimeo.com": {
      const id = parsed.pathname.match(/\/(\d+)/)?.[1]
      return id
        ? {
            type: "iframe",
            src: `https://player.vimeo.com/video/${id}`,
            aspect: "video",
            sandbox: `${MEDIA_SANDBOX} allow-presentation`,
            allow: "autoplay; fullscreen; picture-in-picture",
          }
        : fallback(url, hostLabel)
    }
    case "open.spotify.com": {
      const path = parsed.pathname.startsWith("/embed/")
        ? parsed.pathname
        : `/embed${parsed.pathname}`
      return {
        type: "iframe",
        src: `https://open.spotify.com${path}${parsed.search}`,
        aspect: "auto",
        sandbox: APP_SANDBOX,
        allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
      }
    }
    case "soundcloud.com": {
      return {
        type: "iframe",
        src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}`,
        aspect: "auto",
        sandbox: APP_SANDBOX,
        allow: "autoplay",
      }
    }
    case "figma.com": {
      return {
        type: "iframe",
        src: `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url)}`,
        aspect: "auto",
        sandbox: APP_SANDBOX,
        allow: "fullscreen",
      }
    }
    case "gist.github.com": {
      const gistPath = parsed.pathname.replace(/\/$/, "")
      return {
        type: "iframe",
        src: `https://gist.github.com${gistPath}.pibb`,
        aspect: "auto",
        sandbox: APP_SANDBOX,
      }
    }
    default:
      return fallback(url, hostLabel)
  }
}
