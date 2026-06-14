"use client"

import { CalendarDays } from "lucide-react"

export function CalendarEmbed() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-hp">
        <CalendarDays className="h-5 w-5" />
        <h3 className="text-lg font-semibold">予約可能枠</h3>
      </div>
      <p className="text-sm text-hp-muted">
        下記の枠から空き状況を確認し、リクエストを送信できます。
      </p>
      <div className="glass-inset p-6 min-h-[300px] flex items-center justify-center">
        <div className="text-center text-hp-muted">
          <CalendarDays className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">カレンダー統合は次のフェーズで実装予定</p>
        </div>
      </div>
    </div>
  )
}
