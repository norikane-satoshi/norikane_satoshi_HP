"use client"

import { useEffect, useRef, useState } from "react"

const TOOLTIP_DELAY_MS = 500

export function ProfileToolBadges({ tools }: { tools: readonly string[] }) {
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [instant, setInstant] = useState(false)
  const hasEnteredRow = useRef(false)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearShowTimer = () => {
    if (showTimer.current !== null) {
      clearTimeout(showTimer.current)
      showTimer.current = null
    }
  }

  const showTool = (tool: string, showImmediately: boolean) => {
    clearShowTimer()

    if (showImmediately) {
      setInstant(true)
      setActiveTool(tool)
      return
    }

    showTimer.current = setTimeout(() => {
      setInstant(false)
      setActiveTool(tool)
      showTimer.current = null
    }, TOOLTIP_DELAY_MS)
  }

  const hideTool = (tool: string) => {
    clearShowTimer()
    setActiveTool((currentTool) => (currentTool === tool ? null : currentTool))
  }

  useEffect(() => () => clearShowTimer(), [])

  return (
    <div className="flex flex-wrap justify-center gap-2 @[680px]/profile:justify-start">
      {tools.map((tool, index) => {
        const tooltipId = `profile-tool-tooltip-${index}`
        const isActive = activeTool === tool

        return (
          <span
            key={tool}
            className="profile-tool-badge-wrap"
            tabIndex={0}
            aria-describedby={isActive ? tooltipId : undefined}
            onPointerEnter={() => {
              const isFirstEntry = !hasEnteredRow.current
              hasEnteredRow.current = true
              showTool(tool, !isFirstEntry)
            }}
            onPointerLeave={() => hideTool(tool)}
            onFocus={() => showTool(tool, true)}
            onBlur={() => hideTool(tool)}
          >
            <span className="glass-badge glass-badge--profile-tool px-3 py-1 text-xs font-medium">
              {tool}
            </span>
            {isActive ? (
              <span
                id={tooltipId}
                role="tooltip"
                className="profile-tool-tooltip"
                data-entry={instant ? "instant" : "delayed"}
              >
                {tool}
              </span>
            ) : null}
          </span>
        )
      })}
    </div>
  )
}
