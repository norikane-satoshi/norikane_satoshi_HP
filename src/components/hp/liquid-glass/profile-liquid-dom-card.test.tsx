// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ProfileLiquidDomCard } from "@/components/hp/liquid-glass/profile-liquid-dom-card"

const liquidDomTestState = vi.hoisted(() => ({
  nodeRecords: [] as Array<{
    childCount: number
    childNames: string[]
    name: string
  }>,
  supportsLiquidDomProfileCard: vi.fn(() => false),
}))

vi.mock("@/components/hp/liquid-glass/capability", () => ({
  supportsLiquidDomProfileCard: liquidDomTestState.supportsLiquidDomProfileCard,
}))

vi.mock("@liquid-dom/react", async () => {
  const React = await import("react")

  function makeLiquidNode(name: string) {
    function LiquidNode({ children }: { children?: React.ReactNode }) {
      const childNames = React.Children.toArray(children).map((child) => {
        if (!React.isValidElement(child)) {
          return typeof child
        }

        const type = child.type

        if (typeof type === "string") {
          return type
        }

        return (
          (type as { displayName?: string }).displayName ??
          (typeof type === "function" ? type.name : "anonymous")
        )
      })

      liquidDomTestState.nodeRecords.push({
        childCount: React.Children.count(children),
        childNames,
        name,
      })

      return React.createElement("div", { "data-liquid-dom-node": name }, children)
    }

    LiquidNode.displayName = name
    return LiquidNode
  }

  return {
    Frame: makeLiquidNode("Frame"),
    Glass: makeLiquidNode("Glass"),
    GlassContainer: makeLiquidNode("GlassContainer"),
    Html: makeLiquidNode("Html"),
    LiquidCanvas: makeLiquidNode("LiquidCanvas"),
    ZStack: makeLiquidNode("ZStack"),
  }
})

const root = process.cwd()

function readProjectFile(path: string) {
  return readFileSync(join(root, path), "utf8")
}

function latestRecord(name: string) {
  const records = liquidDomTestState.nodeRecords.filter((record) => record.name === name)
  return records.at(-1)
}

afterEach(() => {
  vi.restoreAllMocks()
  liquidDomTestState.nodeRecords.length = 0
  liquidDomTestState.supportsLiquidDomProfileCard.mockReturnValue(false)
})

describe("ProfileLiquidDomCard", () => {
  it("renders the clean profile fallback and mounts no liquid-dom canvas by default", () => {
    const { container } = render(
      <ProfileLiquidDomCard
        className="glass-card glass-card--hp-profile hp-shadow-sync-surface hp-shadow-sync-surface--profile p-8 md:p-10 xl:p-12"
        shadowLayer={<div data-testid="profile-shadow-layer" />}
      >
        <p>Profile foreground</p>
      </ProfileLiquidDomCard>,
    )

    expect(container.querySelector("canvas")).not.toBeInTheDocument()
    expect(container.querySelector("[data-hp-liquid-dom-profile-card='true']")).not.toBeInTheDocument()
    expect(container.querySelector("[data-hp-profile-card-fallback='clean-shadow']")).toBeInTheDocument()
    expect(container.querySelector("[data-liquid-dom-node='LiquidCanvas']")).not.toBeInTheDocument()
    expect(liquidDomTestState.nodeRecords).toEqual([])
    expect(screen.getByTestId("profile-shadow-layer")).toBeInTheDocument()
    expect(screen.getByText("Profile foreground")).toBeInTheDocument()
  })

  it("keeps LiquidCanvas to one ZStack child in the liquid-dom profile path", async () => {
    liquidDomTestState.supportsLiquidDomProfileCard.mockReturnValue(true)
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 360,
      height: 360,
      left: 0,
      right: 480,
      top: 0,
      width: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    const { container } = render(
      <ProfileLiquidDomCard
        className="glass-card glass-card--hp-profile hp-shadow-sync-surface hp-shadow-sync-surface--profile p-8 md:p-10 xl:p-12"
        shadowLayer={<div data-testid="profile-shadow-layer" />}
      >
        <p>Profile foreground</p>
      </ProfileLiquidDomCard>,
    )

    await waitFor(() => {
      expect(container.querySelector("[data-hp-liquid-dom-profile-card='true']")).toBeInTheDocument()
    })

    expect(latestRecord("LiquidCanvas")).toMatchObject({
      childCount: 1,
      childNames: ["ZStack"],
    })
    expect(latestRecord("ZStack")).toMatchObject({
      childCount: 2,
      childNames: ["Frame", "GlassContainer"],
    })
    expect(latestRecord("GlassContainer")).toMatchObject({
      childCount: 1,
      childNames: ["Frame"],
    })
    expect(latestRecord("Glass")).toMatchObject({
      childCount: 1,
      childNames: ["Html"],
    })
    expect(liquidDomTestState.nodeRecords.filter((record) => record.name === "Frame")).toEqual([
      expect.objectContaining({ childCount: 1, childNames: ["Html"] }),
      expect.objectContaining({ childCount: 1, childNames: ["Glass"] }),
    ])
  })

  it("integrates the U-1 proof into the profile card instead of rendering a separate proof panel", () => {
    const page = readProjectFile("src/app/page.tsx")
    const profileCard = readProjectFile(
      "src/components/hp/liquid-glass/profile-liquid-dom-card.tsx",
    )
    const css = readProjectFile("src/app/globals.css")

    expect(page).toContain("<ProfileLiquidDomCard")
    expect(page).not.toContain("ProfileLiquidDomProof")
    expect(page).not.toContain("data-hp-liquid-dom-proof")
    expect(profileCard).toContain("supportsLiquidDomProfileCard")
    expect(profileCard).toContain("frameloop=\"demand\"")
    expect(profileCard).toContain("document.visibilityState === \"visible\"")
    expect(profileCard).toContain("IntersectionObserver")
    expect(profileCard).toContain("const { Frame, Glass, GlassContainer, Html, LiquidCanvas, ZStack } = liquidDom")
    expect(profileCard).toContain("GlassContainer {...PROFILE_GLASS_OPTICS}")
    expect(profileCard).toContain("Glass {...PROFILE_GLASS_SHAPE}")
    expect(profileCard).toContain("Html sizing=\"fill\" zIndex={1}")
    expect(profileCard).toContain("displacementFactor: 0.18")
    expect(profileCard).toContain("thickness: 42")
    expect(profileCard).toContain("ior: 1.16")
    expect(profileCard).toContain("dispersion: 0.012")
    expect(css).toContain(".hp-liquid-dom-profile-backdrop")
    expect(css).toContain(".hp-liquid-dom-profile-html.glass-card--hp-profile")
  })
})
