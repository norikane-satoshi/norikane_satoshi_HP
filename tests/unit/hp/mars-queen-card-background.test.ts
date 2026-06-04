import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()

function readProjectFile(path: string) {
  return readFileSync(join(root, path), "utf8")
}

describe("Mars Queen featured work card background", () => {
  it("uses a neutral cinematic deep field for the abstract cover", () => {
    const hero = readProjectFile("src/components/hp/hero-section.tsx")
    const featuredWorks = readProjectFile("src/components/hp/featured-works.tsx")
    const surface = readProjectFile("src/components/hp/hero-deep-surface.ts")

    expect(hero).toContain("HERO_DEEP_SURFACE_BACKGROUND")
    expect(featuredWorks).toContain("MARS_ABSTRACT_COVER_BACKGROUND")
    expect(featuredWorks).not.toContain("HERO_ABSTRACT_ART_BACKGROUND")
    expect(featuredWorks).not.toContain('data-hp-abstract-art="mars"')
    expect(surface).toContain("MARS_ABSTRACT_COVER_BACKGROUND")
    expect(surface).toContain("#101114")
    expect(surface).toContain("#15161B")
    expect(surface).not.toContain("rgba(224, 76, 140")
    expect(surface).not.toContain("rgba(188, 60, 74")
    expect(surface).not.toContain("rgba(54, 139, 214")
  })

  it("keeps the abstract cover free of section H color art and utility gradients", () => {
    const featuredWorks = readProjectFile("src/components/hp/featured-works.tsx")
    const abstractCoverBranch =
      featuredWorks.match(/<PreviewFrame abstractCover>[\s\S]*?<\/PreviewFrame>/)?.[0] ??
      featuredWorks

    expect(abstractCoverBranch).not.toContain("#7568D6")
    expect(abstractCoverBranch).not.toContain("#302B55")
    expect(abstractCoverBranch).not.toContain("#D4D0E8")
    expect(abstractCoverBranch).not.toContain("pink-red-blue")
    expect(abstractCoverBranch).not.toContain('data-hp-abstract-art="mars"')
    expect(abstractCoverBranch).not.toMatch(/bg-\[radial-gradient/i)
  })
})
