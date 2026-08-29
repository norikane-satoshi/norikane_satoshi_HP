import {describe, expect, it} from "vitest"
import {localeAlternates} from "@/i18n/metadata"
import {routing} from "@/i18n/routing"
import {getHpPublicContent} from "@/lib/hp/public-content"

describe("localized public routes", () => {
  it("keeps Japanese as the default and exposes explicit ja/en prefixes", () => {
    expect(routing.defaultLocale).toBe("ja")
    expect(routing.locales).toEqual(["ja", "en"])
    expect(routing.localePrefix).toBe("always")
    expect(routing.localeDetection).toBe(true)
  })

  it("builds canonical and hreflang URLs for both note languages", () => {
    expect(localeAlternates("/notes/correction", "en")).toEqual({
      canonical: "https://norikane.studio/en/notes/correction",
      languages: {
        ja: "https://norikane.studio/ja/notes/correction",
        en: "https://norikane.studio/en/notes/correction",
        "x-default": "https://norikane.studio/ja/notes/correction",
      },
    })
  })

  it("selects independent Japanese and English public profile copy", () => {
    expect(getHpPublicContent("ja").profile.sectionTitle).toBe("プロフィール")
    expect(getHpPublicContent("en").profile.sectionTitle).toBe("Profile")
  })
})
