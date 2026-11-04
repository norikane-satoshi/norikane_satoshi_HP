/** セクション見出し。英字の大見出しと、番号付きの日本語ラベルを罫線の上に並べる。 */
export function SectionHeading({
  index,
  latin,
  label,
}: {
  index: string
  latin: string
  label: string
}) {
  return (
    <div className="hp-section-heading-row">
      <h2 className="hp-latin-display">{latin}</h2>
      <p className="hp-section-label">
        <span className="font-[var(--font-inter)] text-xs">{index}</span>
        {label}
      </p>
    </div>
  )
}
