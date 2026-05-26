"use client"

import type { DemoCursorPoint, DemoPlacement } from "@/lib/chatbot/demo"

type DemoAnnotationProps = {
  title: string
  body: string
  placement?: DemoPlacement
  target: DemoCursorPoint
  visible?: boolean
}

const clampRatio = (value: number) => Math.max(0, Math.min(1, value))

const placementClass: Record<DemoPlacement, string> = {
  top: "-translate-x-1/2 -translate-y-[calc(100%+20px)]",
  right: "translate-x-6 -translate-y-1/2",
  bottom: "-translate-x-1/2 translate-y-6",
  left: "-translate-x-[calc(100%+24px)] -translate-y-1/2",
}

export function DemoAnnotation({
  title,
  body,
  placement = "top",
  target,
  visible = true,
}: DemoAnnotationProps) {
  if (!visible) return null

  return (
    <aside
      role="status"
      aria-live="polite"
      className={[
        "glass-inset fixed z-[69] w-[min(18rem,calc(100vw-2rem))] p-4",
        "motion-reduce:transition-none",
        placementClass[placement],
      ].join(" ")}
      style={{
        left: `${clampRatio(target.xRatio) * 100}%`,
        top: `${clampRatio(target.yRatio) * 100}%`,
        transition: "left 320ms ease, top 320ms ease, opacity 180ms ease",
      }}
      data-placement={placement}
    >
      <h3 className="text-sm font-semibold text-hp">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-hp-muted">{body}</p>
    </aside>
  )
}
