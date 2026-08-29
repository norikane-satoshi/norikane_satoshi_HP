"use client"

import { CalendarDays } from "lucide-react"
import { useLocale } from "next-intl"
import { getLocalizedCopy } from "@/i18n/copy"

export function CalendarEmbed() {
  const copy = getLocalizedCopy(useLocale(), "Booking")
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-hp">
        <CalendarDays className="h-5 w-5" />
        <h3 className="text-lg font-semibold">{copy.availableSlots}</h3>
      </div>
      <p className="text-sm text-hp-muted">
        {copy.calendarEmbedHelp}
      </p>
      <div className="glass-inset glass-inset--hp-schedule p-6 min-h-[300px] flex items-center justify-center">
        <div className="text-center text-hp-muted">
          <CalendarDays className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">{copy.calendarEmbedPlanned}</p>
        </div>
      </div>
    </div>
  )
}
