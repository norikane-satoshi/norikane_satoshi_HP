import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()

function readProjectFile(path: string) {
  return readFileSync(join(root, path), "utf8")
}

describe("Mars Queen featured work card background", () => {
  it("uses the same deep surface source as the hero placeholder", () => {
    const hero = readProjectFile("src/components/hp/hero-section.tsx")
    const featuredWorks = readProjectFile("src/components/hp/featured-works.tsx")

    expect(hero).toContain("HERO_DEEP_SURFACE_BACKGROUND")
    expect(featuredWorks).toContain("HERO_DEEP_SURFACE_BACKGROUND")
    expect(featuredWorks).toContain("style={{ background: HERO_DEEP_SURFACE_BACKGROUND }}")
  })

  it("removes the retired purple abstract cover gradients", () => {
    const featuredWorks = readProjectFile("src/components/hp/featured-works.tsx")
    const abstractCoverBranch =
      featuredWorks.match(/<PreviewFrame abstractCover>[\s\S]*?<\/PreviewFrame>/)?.[0] ??
      featuredWorks

    expect(abstractCoverBranch).not.toContain("#7568D6")
    expect(abstractCoverBranch).not.toContain("#302B55")
    expect(abstractCoverBranch).not.toContain("#D4D0E8")
    expect(abstractCoverBranch).not.toMatch(/bg-\[radial-gradient/i)
  })
})
