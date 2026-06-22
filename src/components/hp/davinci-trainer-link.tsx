"use client"

import type { MouseEvent, ReactNode } from "react"

import {
  DAVINCI_RESOLVE_TRAINING_BASE_URL,
  DAVINCI_RESOLVE_TRAINING_URL,
} from "@/lib/hp/davinci-trainer"

const PARTNERS_NAVIGATION_DELAYS_MS = [2200, 5500] as const
const HASH_REAPPLY_DELAY_MS = 150

type DavinciTrainerLinkProps = {
  children: ReactNode
  className?: string
}

export function DavinciTrainerLink({ children, className }: DavinciTrainerLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.detail === 0
    ) {
      return
    }

    const newWindow = window.open("about:blank", "_blank")
    if (!newWindow) {
      return
    }

    event.preventDefault()
    newWindow.opener = null
    newWindow.location.href = DAVINCI_RESOLVE_TRAINING_BASE_URL

    for (const delay of PARTNERS_NAVIGATION_DELAYS_MS) {
      window.setTimeout(() => {
        try {
          newWindow.location.href = DAVINCI_RESOLVE_TRAINING_BASE_URL
          window.setTimeout(() => {
            try {
              newWindow.location.href = DAVINCI_RESOLVE_TRAINING_URL
            } catch {
              // The base navigation remains a normal fallback if the browser severs the window reference.
            }
          }, HASH_REAPPLY_DELAY_MS)
        } catch {
          // The first navigation remains a normal fallback if the browser severs the window reference.
        }
      }, delay)
    }
  }

  return (
    <a
      href={DAVINCI_RESOLVE_TRAINING_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={handleClick}
    >
      {children}
    </a>
  )
}
