"use client"

type RevisitNoteProps = {
  customerName?: string
}

export function RevisitNote({ customerName }: RevisitNoteProps) {
  const displayName = customerName?.trim() || "同じアカウント"

  return (
    <aside className="glass-inset p-4 text-sm leading-relaxed text-hp" aria-label="再訪案内">
      <p className="font-semibold">{displayName}で次回も続きから確認できます。</p>
      <p className="mt-1 text-xs text-hp-muted">次回も同じアカウントでカレンダーが見えますよ。</p>
    </aside>
  )
}
