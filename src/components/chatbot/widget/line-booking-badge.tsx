export function LineBookingBadge() {
  return (
    <a
      className="glass-badge pointer-events-auto inline-flex h-11 w-11 items-center justify-center !border-[#05B94F] !bg-[#06C755] p-0 text-[var(--text-primary)] !shadow-[var(--hp-shadow-soft)] hover:!border-[#049F43] hover:!bg-[#05B94F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
      href="https://line.me/R/ti/p/%40044ucnym"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="公式LINEを友だち追加"
    >
      <svg aria-hidden="true" className="h-9 w-9" viewBox="3 3 18 18" fill="none">
        <path
          d="M20 11.2c0-4.09-3.58-7.4-8-7.4s-8 3.31-8 7.4c0 2.68 1.56 5.03 3.9 6.33L6.8 20l3.24-1.08c.63.18 1.28.28 1.96.28 4.42 0 8-3.31 8-7.4Z"
          fill="currentColor"
        />
        <text x="12" y="13.4" fill="#06C755" fontSize="5.3" fontWeight="700" textAnchor="middle">
          LINE
        </text>
      </svg>
    </a>
  )
}
