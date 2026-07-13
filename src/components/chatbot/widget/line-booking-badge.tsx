import { MessageCircle } from "lucide-react"

export function LineBookingBadge() {
  return (
    <a
      className="glass-badge pointer-events-auto inline-flex min-h-11 items-center gap-2 px-4 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
      href="https://line.me/R/ti/p/%40044ucnym"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="公式LINEを友だち追加"
    >
      <MessageCircle aria-hidden="true" className="h-4 w-4" />
      <span>LINE予約</span>
    </a>
  )
}
