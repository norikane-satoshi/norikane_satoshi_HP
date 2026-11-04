import { ArrowUpRight } from "lucide-react"
import { PRESS_CATEGORIES, type PressItem, type PressLink } from "@/components/hp/press-data"

/** 「2026年10月」「2024年」を並べ替え用の数値（年×100＋月）にする。 */
function getPeriodSortKey(period: string) {
  const match = period.match(/(\d{4})年(?:(\d{1,2})月)?/)
  if (!match) return 0
  return Number(match[1]) * 100 + Number(match[2] ?? 0)
}

/** リンク名が URL そのものなら、ドメイン名だけを見せる。 */
function getLinkText(link: PressLink) {
  if (!/^https?:\/\//.test(link.label)) return link.label
  const host = new URL(link.href).hostname.replace(/^www\./, "")
  return host === "web.archive.org" ? "web.archive.org（保存版）" : host
}

function sortByPeriod(items: readonly PressItem[]) {
  return [...items].sort((a, b) => getPeriodSortKey(b.period) - getPeriodSortKey(a.period))
}

/** 登壇・掲載の一覧。カテゴリごとに新しい順で並べる。 */
export function PressList() {
  return (
    <div className="flex flex-col">
      {PRESS_CATEGORIES.map((category) => (
        <section
          key={category.title}
          aria-labelledby={`press-${category.title}`}
          className="mt-[clamp(2.5rem,4.5vw,4rem)] flex flex-wrap gap-x-16 gap-y-4"
        >
          <h3
            id={`press-${category.title}`}
            className="flex-[1_1_13.75rem] break-normal pt-6 text-[0.9375rem] font-medium tracking-[0.16em] text-hp-muted"
          >
            {category.title}
          </h3>
          <ul className="min-w-0 flex-[3_1_35rem]">
            {sortByPeriod(category.items).map((item) => (
              <li
                key={`${item.period}-${item.title}`}
                className="hp-rule-bottom grid grid-cols-[minmax(5.25rem,7.5rem)_minmax(0,1fr)] gap-x-5 gap-y-2 py-6"
                data-press-item
              >
                <p className="pt-1 font-[var(--font-inter)] text-xs tracking-[0.1em] text-hp-muted">
                  {item.period}
                </p>
                <div className="flex min-w-0 flex-col gap-3">
                  <h4 className="break-normal text-[clamp(1rem,1.25vw,1.125rem)] font-medium leading-[1.75] tracking-[0.04em] text-hp">
                    {item.title}
                  </h4>
                  <p className="hp-body text-sm leading-[1.95] text-hp-muted">{item.description}</p>
                  <div className="flex flex-wrap gap-x-6 font-[var(--font-inter)] text-xs tracking-[0.08em]">
                    {item.links.map((link) => (
                      <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hp-plain-link inline-flex min-h-11 items-center gap-1.5"
                        aria-label={`${item.title} ${getLinkText(link)}を新しいタブで開く`}
                      >
                        {getLinkText(link)}
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
