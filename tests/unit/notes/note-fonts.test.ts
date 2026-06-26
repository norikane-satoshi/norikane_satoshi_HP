import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8")
const globals = readFileSync(join(root, "src/app/globals.css"), "utf8")

describe("note page typography scope", () => {
  it("loads Gothic only as a scoped CSS variable while keeping global text and headings Mincho", () => {
    expect(layout).toContain("Noto_Sans_JP")
    expect(layout).toContain('variable: "--font-gothic"')
    expect(layout).toMatch(/className=\{`[^`]*\$\{notoSerifJP\.variable\} \$\{notoSansJP\.variable\}/)

    expect(globals).toContain("--font-sans: var(--font-mincho);")
    expect(globals).toContain("--font-heading: var(--font-mincho);")
    expect(globals).toMatch(/h1,[\s\S]*h6\s*\{\s*font-family: var\(--font-mincho\), serif;/)
  })

  it("applies Gothic only to rendered note body copy under the note article", () => {
    expect(globals).toContain(
      "article.glass-card--hp-note-page > div :where(p, li, blockquote)"
    )
    expect(globals).toMatch(
      /article\.glass-card--hp-note-page > div :where\(p, li, blockquote\)\s*\{\s*font-family: var\(--font-gothic\), sans-serif;/
    )
    expect(globals).not.toMatch(
      /article\.glass-card--hp-note-page\s*\{[^}]*font-family: var\(--font-gothic\)/
    )
    expect(globals).not.toMatch(
      /article\.glass-card--hp-note-page[^}]*:where\([^)]*h[1-6][^)]*\)[^{]*\{[^}]*font-family: var\(--font-gothic\)/
    )
  })
})
