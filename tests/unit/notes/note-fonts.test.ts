import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8")
const globals = readFileSync(join(root, "src/app/globals.css"), "utf8")
const renderBlocks = readFileSync(join(root, "src/lib/notion/server/render-blocks.tsx"), "utf8")

describe("note page typography scope", () => {
  it("loads Gothic as a scoped variable while keeping global text and headings Mincho", () => {
    expect(layout).toContain("Noto_Sans_JP")
    expect(layout).toContain('variable: "--font-gothic"')
    expect(layout).toMatch(/className=\{`[^`]*\$\{notoSerifJP\.variable\} \$\{notoSansJP\.variable\}/)

    expect(globals).toContain("--font-sans: var(--font-mincho);")
    expect(globals).toContain("--font-heading: var(--font-mincho);")
    expect(globals).toMatch(/h1,[\s\S]*h6\s*\{\s*font-family: var\(--font-mincho\), serif;/)
  })

  it("applies Mincho to rendered note body copy under the note article", () => {
    expect(globals).toContain(
      "article.glass-card--hp-note-page > div :where(p, li, blockquote)"
    )
    expect(globals).toMatch(
      /article\.glass-card--hp-note-page > div :where\(p, li, blockquote\)\s*\{\s*font-family: var\(--font-mincho\), serif;\s*font-weight: 400;/
    )
    expect(layout).toMatch(/Noto_Sans_JP\(\{[\s\S]*weight: \["300", "400", "500", "600", "700"\]/)
    expect(renderBlocks).toContain('className="font-semibold text-hp"')
    expect(globals).not.toMatch(
      /article\.glass-card--hp-note-page\s*\{[^}]*font-family: var\(--font-gothic\)/
    )
  })

  it("applies Gothic to the note title and rendered note headings", () => {
    expect(globals).toContain(
      "article.glass-card--hp-note-page :where(.hp-note-title, h2, h3, h4)"
    )
    expect(globals).toMatch(
      /article\.glass-card--hp-note-page :where\(\.hp-note-title, h2, h3, h4\)\s*\{\s*font-family: var\(--font-gothic\), sans-serif;/
    )
    expect(renderBlocks).toContain(
      'className="mt-10 mb-5 text-2xl font-semibold text-hp md:text-3xl"'
    )
    expect(renderBlocks).toContain(
      'className="mt-8 mb-4 text-xl font-semibold text-hp md:text-2xl"'
    )
  })
})
