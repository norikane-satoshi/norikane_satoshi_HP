import Image from "next/image"

export function LineBookingBadge() {
  return (
    <a
      className="glass-badge glass-badge--profile-tool pointer-events-auto inline-flex h-12 w-12 items-center justify-center p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
      href="https://line.me/R/ti/p/%40044ucnym"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="公式LINEを友だち追加"
    >
      <Image
        src="/line-brand-icon.png"
        alt=""
        width={40}
        height={40}
        priority={false}
      />
    </a>
  )
}
