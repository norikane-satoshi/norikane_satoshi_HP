"use client"

import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type ForwardedRef,
  type InputEvent,
  type WheelEvent as ReactWheelEvent,
} from "react"

import { cn } from "@/lib/utils"

type AutoResizeTextareaProps = ComponentPropsWithoutRef<"textarea"> & {
  maxRows?: number
}

const SCROLL_EPSILON_PX = 1

function numericStyleValue(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function lineHeightPx(textarea: HTMLTextAreaElement, style: CSSStyleDeclaration) {
  const parsed = Number.parseFloat(style.lineHeight)
  if (Number.isFinite(parsed)) return parsed
  const fontSize = numericStyleValue(style.fontSize)
  return fontSize > 0 ? fontSize * 1.5 : 24
}

function maxHeightForRows(textarea: HTMLTextAreaElement, maxRows: number) {
  const style = window.getComputedStyle(textarea)
  const paddingY = numericStyleValue(style.paddingTop) + numericStyleValue(style.paddingBottom)
  return lineHeightPx(textarea, style) * maxRows + paddingY
}

function syncTextareaHeight(textarea: HTMLTextAreaElement | null, maxRows?: number) {
  if (!textarea) return
  textarea.style.height = "auto"

  if (!maxRows) {
    textarea.style.height = `${textarea.scrollHeight}px`
    textarea.style.overflowY = "hidden"
    return
  }

  const maxHeight = maxHeightForRows(textarea, maxRows)
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight)
  textarea.style.height = `${nextHeight}px`
  textarea.style.overflowY = textarea.scrollHeight > maxHeight + SCROLL_EPSILON_PX ? "auto" : "hidden"
}

function keepTextareaCaretVisible(textarea: HTMLTextAreaElement) {
  if (typeof textarea.scrollIntoView !== "function") return

  const caretAtEnd = textarea.selectionEnd >= textarea.value.length
  textarea.scrollIntoView({
    block: caretAtEnd ? "end" : "nearest",
    inline: "nearest",
  })
}

function canScrollTextareaForDelta(textarea: HTMLTextAreaElement, deltaY: number) {
  if (deltaY === 0 || textarea.scrollHeight <= textarea.clientHeight + SCROLL_EPSILON_PX) return false
  if (deltaY < 0) return textarea.scrollTop > SCROLL_EPSILON_PX
  return textarea.scrollTop + textarea.clientHeight < textarea.scrollHeight - SCROLL_EPSILON_PX
}

function findScrollableAncestor(textarea: HTMLTextAreaElement) {
  let element = textarea.parentElement
  while (element) {
    const style = window.getComputedStyle(element)
    const hasScrollableOverflowY =
      /(auto|scroll)/.test(style.overflowY) ||
      element.classList.contains("overflow-y-auto") ||
      element.classList.contains("overflow-y-scroll")
    if (hasScrollableOverflowY && element.scrollHeight > element.clientHeight + SCROLL_EPSILON_PX) {
      return element
    }
    element = element.parentElement
  }
  return null
}

function handOffWheelScroll(textarea: HTMLTextAreaElement, deltaY: number) {
  const scrollableAncestor = findScrollableAncestor(textarea)
  if (scrollableAncestor) {
    const before = scrollableAncestor.scrollTop
    scrollableAncestor.scrollTop += deltaY
    return scrollableAncestor.scrollTop !== before
  }

  const before = window.scrollY
  window.scrollBy(0, deltaY)
  return window.scrollY !== before
}

function assignRef(ref: ForwardedRef<HTMLTextAreaElement>, value: HTMLTextAreaElement | null) {
  if (typeof ref === "function") {
    ref(value)
    return
  }
  if (ref) {
    ref.current = value
  }
}

export const AutoResizeTextarea = forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(
  function AutoResizeTextarea(
    { className, defaultValue, maxRows, onChange, onInput, onWheel, value, ...props },
    forwardedRef,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)

    const setTextareaRef = useCallback(
      (textarea: HTMLTextAreaElement | null) => {
        textareaRef.current = textarea
        assignRef(forwardedRef, textarea)
      },
      [forwardedRef],
    )

    useLayoutEffect(() => {
      syncTextareaHeight(textareaRef.current, maxRows)
    }, [defaultValue, maxRows, value])

    const handleInput = (event: InputEvent<HTMLTextAreaElement>) => {
      onInput?.(event)
      syncTextareaHeight(event.currentTarget, maxRows)
      keepTextareaCaretVisible(event.currentTarget)
    }

    const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(event)
      syncTextareaHeight(event.currentTarget, maxRows)
      keepTextareaCaretVisible(event.currentTarget)
    }

    const handleWheel = (event: ReactWheelEvent<HTMLTextAreaElement>) => {
      onWheel?.(event)
      if (event.defaultPrevented || canScrollTextareaForDelta(event.currentTarget, event.deltaY)) return
      if (handOffWheelScroll(event.currentTarget, event.deltaY)) {
        event.preventDefault()
      }
    }

    return (
      <textarea
        ref={setTextareaRef}
        className={cn("auto-resize-textarea", className)}
        defaultValue={defaultValue}
        onChange={handleChange}
        onInput={handleInput}
        onWheel={handleWheel}
        value={value}
        {...props}
      />
    )
  },
)
