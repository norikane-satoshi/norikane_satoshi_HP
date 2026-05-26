"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { DemoAnnotation, DemoCursorPoint, DemoScript, DemoStep } from "@/lib/chatbot/demo"

type DemoPlaybackOptions = {
  autoPlay?: boolean
}

const DEFAULT_STEP_DURATION_MS = 900

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

const stepTarget = (steps: DemoStep[], stepIndex: number, initialPoint: DemoCursorPoint) => {
  for (let index = stepIndex; index >= 0; index -= 1) {
    const target = steps[index]?.target
    if (target) return target
  }
  return initialPoint
}

export function useDemoPlayback(script: DemoScript, options: DemoPlaybackOptions = {}) {
  const [stepIndex, setStepIndex] = useState(0)
  const [playing, setPlaying] = useState(Boolean(options.autoPlay))
  const timerRef = useRef<number | null>(null)

  const currentStep = script.steps[stepIndex] ?? null

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const pause = useCallback(() => {
    setPlaying(false)
    clearTimer()
  }, [clearTimer])

  const reset = useCallback(() => {
    clearTimer()
    setStepIndex(0)
    setPlaying(false)
  }, [clearTimer])

  const advance = useCallback(() => {
    setStepIndex((currentIndex) => {
      const nextIndex = Math.min(currentIndex + 1, Math.max(script.steps.length - 1, 0))
      if (nextIndex === currentIndex || script.steps[nextIndex]?.kind === "complete") {
        setPlaying(false)
      }
      return nextIndex
    })
  }, [script.steps])

  const start = useCallback(() => {
    if (script.steps.length === 0) return
    if (script.steps[stepIndex]?.kind === "complete") {
      setStepIndex(0)
    }
    setPlaying(true)
  }, [script.steps, stepIndex])

  useEffect(() => clearTimer, [clearTimer])

  useEffect(() => {
    if (!playing || !currentStep || currentStep.kind === "complete") return

    clearTimer()
    timerRef.current = window.setTimeout(advance, currentStep.durationMs ?? DEFAULT_STEP_DURATION_MS)

    return clearTimer
  }, [advance, clearTimer, currentStep, playing])

  useEffect(() => {
    if (!currentStep || currentStep.kind !== "scroll" || typeof window === "undefined") return

    window.scrollTo({
      top: window.innerHeight * currentStep.scrollTo.yRatio,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    })
  }, [currentStep])

  const cursorPoint = useMemo(
    () => stepTarget(script.steps, stepIndex, script.initialPoint),
    [script.initialPoint, script.steps, stepIndex],
  )

  const annotation: DemoAnnotation | null = currentStep?.annotation ?? null
  const clicking = currentStep?.kind === "click"

  return {
    currentStep,
    cursorPoint,
    annotation,
    clicking,
    playing,
    start,
    pause,
    reset,
    advance,
  }
}
