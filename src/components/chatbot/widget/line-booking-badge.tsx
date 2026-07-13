import { SiLine } from "react-icons/si"

export function LineBookingBadge() {
  return (
    <a
      className="glass-badge glass-badge--profile-tool pointer-events-auto inline-flex h-12 w-12 items-center justify-center p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
      href="https://line.me/R/ti/p/%40044ucnym"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="公式LINEを友だち追加"
    >
      <SiLine aria-hidden="true" className="h-9 w-9 text-[#06C755]" />
    </a>
  )
}
