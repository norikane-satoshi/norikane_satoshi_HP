/** セクション見出し。英字の大見出しを罫線の上に置く。 */
export function SectionHeading({ latin }: { latin: string }) {
  return (
    <div className="hp-section-heading-row">
      <h2 className="hp-latin-display">{latin}</h2>
    </div>
  )
}
