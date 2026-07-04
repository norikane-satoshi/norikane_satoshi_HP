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
} from "react"

import { cn } from "@/lib/utils"

type AutoResizeTextareaProps = ComponentPropsWithoutRef<"textarea">

function syncTextareaHeight(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return
  textarea.style.height = "auto"
  textarea.style.height = `${textarea.scrollHeight}px`
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
    { className, defaultValue, onChange, onInput, value, ...props },
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
      syncTextareaHeight(textareaRef.current)
    }, [defaultValue, value])

    const handleInput = (event: InputEvent<HTMLTextAreaElement>) => {
      onInput?.(event)
      syncTextareaHeight(event.currentTarget)
    }

    const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(event)
      syncTextareaHeight(event.currentTarget)
    }

    return (
      <textarea
        ref={setTextareaRef}
        className={cn("auto-resize-textarea", className)}
        defaultValue={defaultValue}
        onChange={handleChange}
        onInput={handleInput}
        value={value}
        {...props}
      />
    )
  },
)
