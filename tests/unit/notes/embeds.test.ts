import { describe, expect, it } from "vitest"

import { resolveEmbed } from "@/lib/notes/embeds"

describe("notes embed resolver", () => {
  it("resolves X/Twitter statuses and falls back for invalid URLs", () => {
    expect(resolveEmbed("not a url")).toEqual({
      type: "fallback",
      url: "not a url",
      hostLabel: "not a url",
    })
    expect(resolveEmbed("https://x.com/satoshi/status/1234567890")).toEqual({
      type: "tweet",
      statusId: "1234567890",
    })
    expect(resolveEmbed("https://twitter.com/satoshi")).toEqual({
      type: "fallback",
      url: "https://twitter.com/satoshi",
      hostLabel: "twitter.com",
    })
  })

  it("normalizes video provider URLs to iframe embeds", () => {
    expect(resolveEmbed("https://youtu.be/abc123?si=x")).toMatchObject({
      type: "iframe",
      src: "https://www.youtube.com/embed/abc123",
      aspect: "video",
    })
    expect(resolveEmbed("https://www.youtube.com/watch?v=watch-id")).toMatchObject({
      type: "iframe",
      src: "https://www.youtube.com/embed/watch-id",
    })
    expect(resolveEmbed("https://m.youtube.com/shorts/short-id")).toMatchObject({
      type: "iframe",
      src: "https://www.youtube.com/embed/short-id",
    })
    expect(resolveEmbed("https://youtube.com/embed/embed-id")).toMatchObject({
      type: "iframe",
      src: "https://www.youtube.com/embed/embed-id",
    })
    expect(resolveEmbed("https://youtube.com/channel/no-video")).toEqual({
      type: "fallback",
      url: "https://youtube.com/channel/no-video",
      hostLabel: "youtube.com",
    })
    expect(resolveEmbed("https://vimeo.com/987654")).toMatchObject({
      type: "iframe",
      src: "https://player.vimeo.com/video/987654",
      aspect: "video",
    })
    expect(resolveEmbed("https://player.vimeo.com/video/123")).toMatchObject({
      type: "iframe",
      src: "https://player.vimeo.com/video/123",
    })
  })

  it("wraps app/media embeds and generic links with the expected sandbox", () => {
    expect(resolveEmbed("https://open.spotify.com/track/abc?si=1")).toMatchObject({
      type: "iframe",
      src: "https://open.spotify.com/embed/track/abc?si=1",
      aspect: "auto",
    })
    expect(
      resolveEmbed("https://open.spotify.com/embed/episode/def")
    ).toMatchObject({
      type: "iframe",
      src: "https://open.spotify.com/embed/episode/def",
    })
    expect(resolveEmbed("https://soundcloud.com/user/song")).toMatchObject({
      type: "iframe",
      src: "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fuser%2Fsong",
      aspect: "auto",
    })
    expect(resolveEmbed("https://www.figma.com/file/abc/design")).toMatchObject({
      type: "iframe",
      src: "https://www.figma.com/embed?embed_host=share&url=https%3A%2F%2Fwww.figma.com%2Ffile%2Fabc%2Fdesign",
    })
    expect(resolveEmbed("https://gist.github.com/user/abcdef/")).toMatchObject({
      type: "iframe",
      src: "https://gist.github.com/user/abcdef.pibb",
    })
    expect(resolveEmbed("https://example.com/page")).toEqual({
      type: "fallback",
      url: "https://example.com/page",
      hostLabel: "example.com",
    })
  })
})
