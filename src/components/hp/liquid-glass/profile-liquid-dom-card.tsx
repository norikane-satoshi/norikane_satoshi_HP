"use client"

import type { ReactNode, RefObject } from "react"
import { useEffect, useRef, useState } from "react"
import { supportsLiquidDomProfileCard } from "@/components/hp/liquid-glass/capability"

type LiquidDomReactModule = typeof import("@liquid-dom/react")

const PROFILE_GLASS_OPTICS = {
  blur: 10,
  spacing: 20,
  bezelWidth: 10,
  displacementFactor: 0.18,
  displacementBlur: 0.45,
  thickness: 42,
  ior: 1.16,
  contentIor: 1.02,
  contentDepth: 6,
  dispersion: 0.012,
  specularStrength: 0.32,
  specularWidth: 0.42,
  specularFalloff: 0.62,
  specularOpacity: 0.28,
  shadowOffsetY: 14,
  shadowBlur: 34,
  shadowSpread: -8,
  opacity: 1,
} as const

const PROFILE_GLASS_SHAPE = {
  cornerRadius: 20,
  cornerSmoothing: 0.62,
} as const

type ProfileLiquidDomCardProps = {
  children: ReactNode
  className: string
  shadowLayer: ReactNode
}

type RectSize = {
  width: number
  height: number
}

function useElementSize(elementRef: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<RectSize | null>(null)

  useEffect(() => {
    const element = elementRef.current
    if (!element) {
      return
    }

    const update = () => {
      const rect = element.getBoundingClientRect()
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)

      if (width > 0 && height > 0) {
        setSize((current) =>
          current?.width === width && current.height === height
            ? current
            : { width, height },
        )
      }
    }

    update()

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update)
      return () => window.removeEventListener("resize", update)
    }

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(element)

    return () => resizeObserver.disconnect()
  }, [elementRef])

  return size
}

function useProfileLiquidDomModule() {
  const [liquidDom, setLiquidDom] = useState<LiquidDomReactModule | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!supportsLiquidDomProfileCard()) {
      return
    }

    void import("@liquid-dom/react")
      .then((module) => {
        if (!cancelled) {
          setLiquidDom(module)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLiquidDom(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const disableLiquidDom = () => {
    setLiquidDom(null)
  }

  return { liquidDom, disableLiquidDom }
}

function useVisibleLiquidCanvas(
  canUseLiquidDom: boolean,
  elementRef: RefObject<HTMLDivElement | null>,
) {
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  )
  const [isIntersecting, setIsIntersecting] = useState(true)

  useEffect(() => {
    if (!canUseLiquidDom) {
      return
    }

    const updateVisibility = () => {
      setIsDocumentVisible(document.visibilityState === "visible")
    }
    updateVisibility()

    document.addEventListener("visibilitychange", updateVisibility)

    return () => document.removeEventListener("visibilitychange", updateVisibility)
  }, [canUseLiquidDom])

  useEffect(() => {
    const element = elementRef.current

    if (!canUseLiquidDom || !element) {
      return
    }

    if (typeof IntersectionObserver === "undefined") {
      return
    }

    const observer = new IntersectionObserver(([entry]) => {
      setIsIntersecting(Boolean(entry?.isIntersecting))
    })
    observer.observe(element)

    return () => observer.disconnect()
  }, [canUseLiquidDom, elementRef])

  return canUseLiquidDom && isDocumentVisible && isIntersecting
}

export function ProfileLiquidDomCard({
  children,
  className,
  shadowLayer,
}: ProfileLiquidDomCardProps) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const size = useElementSize(shellRef)
  const { liquidDom, disableLiquidDom } = useProfileLiquidDomModule()
  const canUseLiquidDom = Boolean(liquidDom)
  const isVisible = useVisibleLiquidCanvas(canUseLiquidDom, shellRef)
  const shouldRenderLiquidCanvas = Boolean(liquidDom && size && isVisible)

  if (!shouldRenderLiquidCanvas || !liquidDom || !size) {
    return (
      <div
        ref={shellRef}
        className={className}
        data-hp-profile-card-fallback="clean-shadow"
      >
        {shadowLayer}
        <div className="glass-distortion-foreground hp-shadow-sync-foreground">
          {children}
        </div>
      </div>
    )
  }

  const { Frame, Glass, GlassContainer, Html, LiquidCanvas, ZStack } = liquidDom

  return (
    <div
      ref={shellRef}
      className="hp-liquid-dom-profile-shell hp-shadow-sync-surface hp-shadow-sync-surface--profile"
      data-hp-liquid-dom-profile-card="true"
    >
      <div className={`${className} hp-liquid-dom-profile-layout-probe`} aria-hidden="true">
        {shadowLayer}
        <div className="glass-distortion-foreground hp-shadow-sync-foreground">
          {children}
        </div>
      </div>
      <LiquidCanvas
        className="hp-liquid-dom-profile-canvas"
        canvasClassName="h-full w-full"
        frameloop="demand"
        maxDpr={1.5}
        proposal={size}
        onError={disableLiquidDom}
      >
        <ZStack>
          <Frame width={size.width} height={size.height}>
            <Html sizing="fill" zIndex={0}>
              <div className="hp-liquid-dom-profile-backdrop" />
            </Html>
          </Frame>
          <GlassContainer {...PROFILE_GLASS_OPTICS}>
            <Frame width={size.width} height={size.height}>
              <Glass {...PROFILE_GLASS_SHAPE}>
                <Html sizing="fill" zIndex={1}>
                  <div className={`${className} hp-liquid-dom-profile-html`}>
                    {shadowLayer}
                    <div className="glass-distortion-foreground hp-shadow-sync-foreground">
                      {children}
                    </div>
                  </div>
                </Html>
              </Glass>
            </Frame>
          </GlassContainer>
        </ZStack>
      </LiquidCanvas>
    </div>
  )
}
