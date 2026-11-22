# Home note publication dates

For a new Notion article, set `NOTE_SETTINGS[slug].publishedAt` in
`src/lib/hp/home-notes.ts` to its first HP publication date in Japan, using
`YYYY-MM-DD`. Do not use Notion creation or last-edit timestamps. For an external
article, set `publishedAt` on its `EXTERNAL_NOTES` entry using the publisher's date.
Cards without a configured date render without a date. Dates appear as
`YYYY.MM.DD` beside the label. Card order and note/column numbering retain their
existing rules; the display date does not change them.

## Publication evidence

- `ai-thoughts`: `2026-11-22`, the owner's explicit HP publication date in
  C2O job `c2o-20261122-222354-c632` (Notion HP publication enabled that day).
- `correction`: `2026-04-23`. Commit
  `3af3a0b36002d37a7ab7dd3478fd5d6adaf3f0a9` first added the complete
  `src/app/notes/correction/page.tsx` article and its home card. GitHub
  [Production deployment 4458065844](https://api.github.com/repos/norikane-satoshi/norikane_satoshi_HP/deployments/4458065844/statuses)
  records `success` at `2026-04-23T06:05:55Z` (15:05:55 JST) for that commit.
  Earlier prototype content only listed a title/summary; later diagrams and
  revalidation events are not the initial publication.
- PRONEWS: `2026-08-15`, shown below the title on the
  [publisher's article page](https://jp.pronews.com/review/202608150955772789.html).
