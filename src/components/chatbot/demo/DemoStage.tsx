"use client"

import type { ReactNode } from "react"

import type { DemoScript } from "@/lib/chatbot/demo"

import { DemoAnnotation } from "./DemoAnnotation"
import { DemoCursor } from "./DemoCursor"
import { useDemoPlayback } from "./useDemoPlayback"

type DemoStageProps = {
  script: DemoScript
  children: ReactNode
  autoPlay?: boolean
  cursorLabel?: string
  active?: boolean
}

export function DemoStage({
  script,
  children,
  autoPlay = false,
  cursorLabel,
  active = true,
}: DemoStageProps) {
  const playback = useDemoPlayback(script, { autoPlay })

  return (
    <div className="relative" data-demo-playing={playback.playing ? "true" : "false"}>
      {children}
      {active ? (
        <>
          <DemoCursor
            point={playback.cursorPoint}
            active={active}
            clicking={playback.clicking}
            label={cursorLabel}
          />
          {playback.annotation ? (
            <DemoAnnotation
              title={playback.annotation.title}
              body={playback.annotation.body}
              placement={playback.annotation.placement}
              target={playback.cursorPoint}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
