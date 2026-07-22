"use client"

import type { DemoCursorPoint } from "@/lib/chatbot/demo"

type DemoCursorProps = {
  point: DemoCursorPoint
  active?: boolean
  clicking?: boolean
  label?: string
}

const clampRatio = (value: number) => Math.max(0, Math.min(1, value))

export function DemoCursor({ point, active = true, clicking = false, label }: DemoCursorProps) {
  if (!active) return null

  return (
    <div
      className="pointer-events-none fixed z-[70] flex items-start gap-2 motion-reduce:transition-none"
      style={{
        left: `${clampRatio(point.xRatio) * 100}%`,
        top: `${clampRatio(point.yRatio) * 100}%`,
        transform: "translate(-2px, -2px)",
        transition: "left 320ms ease, top 320ms ease",
      }}
      aria-hidden={label ? undefined : true}
      data-clicking={clicking ? "true" : "false"}
    >
      <span className="relative block h-7 w-7">
        <span
          className={[
            "absolute left-0 top-0 h-7 w-7 rounded-full border border-[var(--hp-color-accent)]/60",
            clicking ? "scale-125 opacity-90" : "scale-100 opacity-55",
            "motion-safe:animate-ping motion-reduce:animate-none",
          ].join(" ")}
        />
        <span
          className={[
            "absolute left-1 top-1 block h-0 w-0",
            "border-b-[18px] border-r-[12px] border-b-[var(--text-primary)] border-r-transparent",
          ].join(" ")}
        />
      </span>
      {label ? (
        <span className="glass-badge mt-5 max-w-40 px-3 py-1 text-xs font-medium text-hp">
          {label}
        </span>
      ) : null}
    </div>
  )
}
