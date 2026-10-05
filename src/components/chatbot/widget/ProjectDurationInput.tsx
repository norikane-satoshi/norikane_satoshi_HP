"use client"

import { ChevronDown, ChevronUp } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

type DurationInputProps = {
  initialMinutes?: number
  initialSeconds?: number
  initialUnknown?: boolean
  onChange: (minutes: number | undefined, unknown: boolean) => void
}

const rowHeight = 40

function NumberWheel({ label, value, max, disabled, onChange }: {
  label: string
  value: string
  max: number
  disabled: boolean
  onChange: (value: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reportedValue = useRef<string | undefined>(undefined)
  const options = ["", ...Array.from({ length: max + 1 }, (_, number) => String(number))]

  useEffect(() => {
    if (reportedValue.current === value) return
    reportedValue.current = value
    if (ref.current) ref.current.scrollTop = (value === "" ? 0 : Number(value) + 1) * rowHeight
  }, [value])

  return (
    <div className="relative sm:hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-1 top-10 h-10 rounded-lg border-y border-white/70 bg-white/40" />
      <div
        ref={ref}
        role="listbox"
        aria-label={`${label}を回して選択`}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        className={`relative h-[120px] snap-y snap-mandatory overflow-y-auto overscroll-contain py-10 text-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${disabled ? "pointer-events-none opacity-40" : ""}`}
        onScroll={(event) => {
          const index = Math.max(0, Math.min(options.length - 1, Math.round(event.currentTarget.scrollTop / rowHeight)))
          const next = options[index]
          if (reportedValue.current === next || disabled) return
          reportedValue.current = next
          onChange(next)
        }}
        onKeyDown={(event) => {
          if (disabled || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
          event.preventDefault()
          const next = Math.max(0, Math.min(max, Number(value || 0) + (event.key === "ArrowUp" ? -1 : 1)))
          onChange(String(next))
        }}
      >
        {options.map((option) => (
          <div key={option} role="option" aria-selected={value === option} className={`flex h-10 snap-center items-center justify-center text-2xl tabular-nums ${value === option ? "font-semibold text-hp" : "text-hp-muted"}`}>
            {option === "" ? "—" : option.padStart(2, "0")}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProjectDurationInput({ initialMinutes, initialSeconds, initialUnknown = false, onChange }: DurationInputProps) {
  const id = useId()
  const initialTotal = initialSeconds ?? (initialMinutes === undefined ? undefined : Math.round(initialMinutes * 60))
  const validInitial = Number.isInteger(initialTotal) && initialTotal! > 0 ? initialTotal : undefined
  const [hours, setHours] = useState(validInitial === undefined ? "" : String(Math.floor(validInitial / 3600)))
  const [minutes, setMinutes] = useState(validInitial === undefined ? "" : String(Math.floor(validInitial / 60) % 60))
  const [seconds, setSeconds] = useState(validInitial === undefined ? "" : String(validInitial % 60))
  const [unknown, setUnknown] = useState(initialUnknown)

  function update(nextHours: string, nextMinutes: string, nextSeconds = seconds, nextUnknown = unknown) {
    setHours(nextHours)
    setMinutes(nextMinutes)
    setSeconds(nextSeconds)
    setUnknown(nextUnknown)
    const total = Number(nextHours || 0) * 60 + Number(nextMinutes || 0) + Number(nextSeconds || 0) / 60
    onChange(!nextUnknown && total > 0 ? total : undefined, nextUnknown)
  }

  function field(label: string, value: string, max: number, change: (value: string) => void) {
    return (
      <div className="min-w-0 flex-1 rounded-xl border border-white/55 bg-white/35 px-2 py-1">
        <p className="text-center text-xs font-medium text-hp-muted">{label}</p>
        <button type="button" aria-label={`${label}を1増やす`} disabled={unknown || Number(value) >= max} className="flex h-11 w-full items-center justify-center text-hp-muted disabled:opacity-35" onClick={() => change(String(Math.min(max, Number(value || 0) + 1)))}>
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          aria-label={`尺の${label}`}
          min={0}
          max={max}
          step={1}
          disabled={unknown}
          value={value}
          placeholder="—"
          className="hidden h-14 w-full min-w-0 rounded-lg bg-transparent text-center text-3xl tabular-nums text-hp outline-none focus-visible:ring-2 focus-visible:ring-[var(--hp-color-accent-focus-ring)] disabled:opacity-40 sm:block"
          onChange={(event) => {
            const next = event.target.value
            if (next === "" || (/^\d+$/u.test(next) && Number(next) <= max)) change(next)
          }}
        />
        <NumberWheel label={label} value={value} max={max} disabled={unknown} onChange={change} />
        <button type="button" aria-label={`${label}を1減らす`} disabled={unknown || value === "" || Number(value) === 0} className="flex h-11 w-full items-center justify-center text-hp-muted disabled:opacity-35" onClick={() => change(String(Math.max(0, Number(value) - 1)))}>
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <fieldset aria-label="尺" className="min-w-0">
      <div className="flex items-center gap-2">
        {field("時間", hours, Math.max(99, Number(hours)), (value) => update(value, minutes))}
        {field("分", minutes, 59, (value) => update(hours, value))}
        {field("秒", seconds, 59, (value) => update(hours, minutes, value))}
      </div>
      <label htmlFor={`${id}-unknown`} className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 text-sm text-hp">
        <input id={`${id}-unknown`} type="checkbox" checked={unknown} className="h-4 w-4 accent-[var(--hp-color-accent)]" onChange={(event) => update(hours, minutes, seconds, event.target.checked)} />
        未定
      </label>
    </fieldset>
  )
}
