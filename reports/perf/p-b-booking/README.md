# P-B: ホーム / 予約ページ パフォーマンス深掘り分析

- 測定日: 2026-08-12 JST（認証済み runtime 追測: 2026-08-15 JST）
- 初回分析ソース: `origin/staging` `46b346403270720f87edb8c58db551bf1bbcbcb5`
- 認証追測ソース: `origin/staging` `753e2763f453ef73e703f3af27976e75cb03697c`
- 分析ブランチ: `codex/p-b-booking-auth-analysis-20260815`
- 変更範囲: 本報告書と読み取り専用の測定証跡のみ。機能、UX、UI、文言、レイアウト、アニメーション、アクセシビリティは変更していない。

## 結論

1. 公開本番をスロットリングなしの実回線・実 CPU で 3 回ずつ測ると、ホームの表示完了中央値は mobile `0.269 s` / desktop `0.279 s`、認証済み `/booking` は mobile `0.956 s` / desktop `0.870 s` だった。通常中央値では `12–13 s` を再現しない。
2. 一方、認証済み `/booking` は mobile 1 回目 `6.068 s`（LCP `5.888 s`）、desktop 2 回目 `4.377 s`（LCP `4.200 s`）まで悪化した。TTFB は `7–10 ms` のまま response end が `4.150–5.719 s` へ延びるため、初期 `free-busy` を await してから予約見出しとカレンダーを描画する server data wait が実ユーザー側の長い尾の主因である。
3. P-A-1 の約 `12 s` はさらに、`next dev` の未最適化 bundle `10.93 MB`、main-thread blocking `4.75–4.82 s`、Lighthouse modeled LCP が重なった値である。同じ anonymous 41238 trace の observed LCP は `0.178 s`、認証済み同一 calendar core の `/line/booking` は cold `11.881 s` / 中央値 `1.723 s` だった。
4. 効果順の第一候補は、既存 skeleton を変えず initial free-busy を Suspense stream へ分離すること。次点は miss/bypass を stale-first + background revalidate に寄せること。JS/CSS 分割は有効だが、production の median long task は `58–64 ms` のため server/data wait より優先度が低い。

## backend_execution_failed の根本原因と解消

### 確認した原因

同一 discussion の 3 回の失敗は HP アプリ、依存 package、41238 server の障害ではない。前 backend が長い skill 正本を読むために byte-offset の部分読取を生成し、runner の command safety guard が危険操作として backend 全体を終了した。続く診断では、拒否済み command 文字列を含む広域検索と、広い process discovery を追加したため、同じ guard の dangerous / long-lived 分類を再度踏んだ。つまり、最初の不適切な診断 command と、その command 自体を広く検索する再帰的な調査経路が 3 回連続失敗の根本原因だった。

### 今回の解消と再発防止

- skill は行境界を持つ通常の読み取りで全量確認し、byte-offset 読取を廃止した。
- failure 証拠は exact comment / event identity と既知 path に限定し、拒否済み command 文字列を引数へ再注入する広域検索を廃止した。
- 計測、build、test は終了条件のある foreground command のみで実行し、常駐 process を新設しなかった。原因解消と測定中は既存 41238 process を停止・置換していない。
- safety guard の緩和や迂回は行っていない。この実行経路で既存 18 navigation に加えて認証済み production 6 navigation、41238 canonical-session 15 request、build、test を完走し、同障害は再発しなかった。

## Internal repair: 認証済み経路の再監査（2026-08-15）

前回の terminal claim が認証済み予約 runtime 未検証のまま保留されたため、保存済み認証経路を追加監査し、対話 login を開かず canonical session を確立した。

- 保存済み Gmail connector から通常の Resend magic link を取得し、公開本番 callback で発行された Auth.js session を測定専用 Playwright context へ保存した。公開本番 `/booking` は mobile/desktop 各 3 回とも HTTP `200`、final path `/booking`、session user ID あり。JWT の直接生成、dev auth bypass、OAuth prompt は使用していない。
- 41238 callback でも同じ magic-link flow から canonical session を発行し、`/api/auth/session`、`/api/teams`、`/api/calendar/free-busy` は各 3/3 HTTP `200`、同じ calendar core を server render する `/line/booking` も 3/3 HTTP `200` かつ booking markup ありを確認した。
- exact 41238 `/booking` は canonical cookie を送っても 3/3 HTTP `307`。観測した callback cookie は `__Secure-authjs.session-token` だが、`next dev` の `src/proxy.ts` は `NODE_ENV` から non-secure cookie 名を選び、installed Auth.js `getToken` は cookie 名を decode salt にも使うため、handler が認証済みと判定する同一 session を proxy だけが復号できない。この preview-only cookie-name/salt divergence を認証迂回や server restart で隠していない。
- credential artifact は task-owned temp のみに mode `0600` で保持して追測し、commit 対象の evidence には cookie、token、email、user ID を含めていない。

## 基準 SHA

`git fetch origin` 後の開始時点で三重突合した。

| 観測 | SHA |
|---|---|
| `git rev-parse HEAD` | `753e2763f453ef73e703f3af27976e75cb03697c` |
| `git rev-parse origin/staging` | `753e2763f453ef73e703f3af27976e75cb03697c` |
| `git ls-remote origin refs/heads/staging` | `753e2763f453ef73e703f3af27976e75cb03697c` |

## 測定方法と判定上の注意

- 各条件は fresh page で 3 回実行し、表は中央値。
- mobile: `390 × 844`, DPR 3, touch。desktop: `1440 × 900`, DPR 1。
- 公開本番 anonymous: Lighthouse flow `throttlingMethod=provided`。ネットワークと CPU の DevTools throttle は使用せず、trace の observed metric を実測値として採用した。
- 公開本番 authenticated booking: canonical Resend session、Playwright PerformanceObserver、throttle なし。表示完了は `.booking-calendar .fc` の初回可視、INP 欄は翌月 button 1 interaction の Event Timing duration。field INP ではない。
- 41238: P-A-1 と同じ Lighthouse DevTools throttling。
- 表示完了: Lighthouse trace の `observedLastVisualChange`。INP は指定 interaction（ホームは画像 modal の open/close、ログインは email input click/type）の Event Timing であり、field INP / CrUX ではない。
- Lighthouse audit の `largest-contentful-paint.numericValue` は trace observed LCP と大きく乖離する modeled value だったため、実ユーザー体感判定には observed LCP を使用する。両方を表に残す。
- 41238 の exact `/booking` は上記 proxy divergence を含む実配信挙動として測定し、認証済み calendar core は同一 process の `/line/booking` と API で補完した。41238 を停止、再起動、置換していない。

Raw evidence:

- `production-unthrottled.json`
- `lab-41238-devtools.json`
- `authenticated-booking.json`（SHA-256 は検証結果節）

## 本番とラボの比較

TTFB は LCP breakdown の `Time to first byte`、表示完了は `observedLastVisualChange`。単位は ms、transfer は decimal MB。

| 環境 / target | profile | final page | observed LCP | INP | CLS | TTFB | 表示完了 | transfer | TBT / long task | Lighthouse audit LCP |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 公開本番 `/` | mobile | `/` | 190 | 88 | 0.000 | 9.3 | 269 | 1.526 MB | 0 | 7,890.8 |
| 公開本番 `/` | desktop | `/` | 174 | 88 | 0.000 | 37.3 | 279 | 1.527 MB | 1 | 5,717.4 |
| 公開本番 `/booking` | mobile | `/login?callbackUrl=%2Fbooking` | 243 | 40 | 0.122 | 131.4 | 418 | 1.120 MB | 1 | 4,664.5 |
| 公開本番 `/booking` | desktop | `/login?callbackUrl=%2Fbooking` | 283 | 40 | 0.122 | 177.4 | 387 | 1.118 MB | 3 | 5,564.2 |
| 公開本番 `/booking` authenticated | mobile | `/booking` | 792 | 40 | 0.000 | 9.4 | 956 | 1.250 MB | 64 | n/a |
| 公開本番 `/booking` authenticated | desktop | `/booking` | 708 | 48 | 0.000 | 10.2 | 870 | 1.250 MB | 58 | n/a |
| 41238 `/booking` | mobile | `/login?callbackUrl=%2Fbooking` | 178 | 48 | 0.000 | 53.2 | 1,581 | 10.925 MB | 4,748 | 11,958.1 |
| 41238 `/booking` | desktop | `/login?callbackUrl=%2Fbooking` | 178 | 48 | 0.000 | 47.5 | 1,566 | 10.925 MB | 4,822 | 11,946.5 |

P-A-1 の lab headline はホーム `12.95 s`、予約 `12.00 s`。予約の final URL は今回と同じログイン redirect で、予約カレンダーの測定ではない。P-A-1 の「素材 420 件」は disk inventory であり、初期 network request 数ではない。今回の median request 数は本番ホーム `59`、本番ログイン `46–48`、41238 ログイン `29` だった。

### 実ユーザー体感判定

- 公開本番の中央値では「表示完了が 12–13 秒」を再現しなかった。ホームは `0.28 s` 未満、認証済み booking は `0.96 s` 未満。ただし booking の 3 回値は mobile `6.068 / 0.827 / 0.956 s`、desktop `0.683 / 4.377 / 0.870 s` で、cold/miss 系の長い尾は実在する。
- 認証済み booking の median click Event Timing は `40–48 ms`、翌月表示完了は `58–60 ms`、CLS は `0`。main-thread は中央値で 50 ms 超 task が 1 件だけなので、`4–6 s` sample の原因は client CPU ではなく response/data wait。
- ログイン画面の CLS `0.122` は Core Web Vitals の good 境界 `0.1` を超える。この値は速度ではなく layout stability の別問題。
- 公開本番ログインは存在しない `/forgot-password` の RSC prefetch を毎回 404 にし、各 run で console error 1 件を出した。ホームは console error 0。変更禁止のため本発注では修正していない。

## LCP 要素と待ち時間内訳

text LCP のため `resource load delay / duration` は 0。中央値は phase ごとに独立算出している。

| 環境 / profile | LCP element | TTFB | resource delay | resource duration | render delay | observed LCP |
|---|---|---:|---:|---:|---:|---:|
| 本番 home mobile | Hero `h1`「則兼 智志 / フリーランスカラリスト」 | 9.3 | 0 | 0 | 175.6 | 190 |
| 本番 home desktop | 同上 | 37.3 | 0 | 0 | 133.6 | 174 |
| 本番 booking mobile | login footer copyright | 131.4 | 0 | 0 | 106.8 | 243 |
| 本番 booking desktop | login footer copyright | 177.4 | 0 | 0 | 111.6 | 283 |
| 本番 booking authenticated mobile | `h1`「予約カレンダー」 | 9.4 | 0 | 0 | 782.6 | 792 |
| 本番 booking authenticated desktop | 同上 | 10.2 | 0 | 0 | 697.8 | 708 |
| 41238 booking mobile | login 説明 paragraph | 53.2 | 0 | 0 | 124.5 | 178 |
| 41238 booking desktop | login 説明 paragraph | 47.5 | 0 | 0 | 126.2 | 178 |

anonymous lab では `11.95 s` の audit LCP と `0.178 s` の observed LCP が同一 navigation に共存する。一方、認証済み本番の遅い sample は TTFB `7–10 ms` に対し response end `4.150–5.719 s`、text LCP `4.200–5.888 s`。初期 data promise が解決するまで booking `h1` 自体が render されない構造を示す。

## 41238 初期資産上位 20

41238 `/booking` → login、mobile/desktop 共通の transfer median。cache-busting query は同一 asset に正規化した。`5963...` font は query 有無で二重 request されており、表の size は 1 request 分。

| # | asset | type | transfer | duration | 初期表示に必要か |
|---:|---|---|---:|---:|---|
| 1 | `/_next/static/chunks/app/layout.js` | JS | 6,090.7 KiB | 725–746 ms | dev runtime では必要、production payload としては不要 |
| 2 | `/_next/static/chunks/main-app.js` | JS | 2,656.5 KiB | 231–255 ms | dev runtime では必要、production payload としては不要 |
| 3 | `/_next/static/chunks/app/page.js` | JS | 880.1 KiB | 72–73 ms | 不要。home link prefetch で login 初期に先読み |
| 4 | `/_next/static/css/app/layout.css` | CSS | 274.6 KiB | 44–45 ms | 一部のみ必要。booking 固有 CSS 54,254 raw bytes を global import |
| 5 | `/_next/static/chunks/app/login/page.js` | JS | 107.1 KiB | 12–13 ms | 必要 |
| 6 | `567a398e86416ddb...woff2` | font | 106.5 KiB | 4–6 ms | 必要。Noto Serif JP 日本語 glyph subset |
| 7 | `/_next/static/chunks/app-pages-internals.js` | JS | 60.8 KiB | 10–11 ms | dev runtime では必要、production payload としては不要 |
| 8 | `e4af272ccee01ff0...woff2` | font | 48.3 KiB | 3–5 ms | 初期 LCP には不要。Inter latin preload |
| 9 | `5963f2babe8689ab...woff2` | font | 33.6 KiB × 2 | 3–5 ms | 一部必要だが二重 fetch は不要。Noto Serif JP latin |
| 10 | `/_next/static/chunks/webpack.js` | JS | 28.8 KiB | 7–9 ms | dev runtime では必要、production payload としては不要 |
| 11 | `f3f29441bd95e5ee...woff2` | font | 26.7 KiB | 14–16 ms | 必要。表示文言に該当する Noto Serif JP glyph subset |
| 12 | `/nori_header_black.svg` | image | 26.5 KiB | 9 ms | 必要。header の可視 logo |
| 13 | `24f6ebe2756575bd...woff2` | font | 25.4 KiB | 3–5 ms | 初期 LCP には不要。Noto Sans JP latin preload |
| 14 | `59b86cab0a7ba6b6...woff2` | font | 24.9 KiB | 16–17 ms | 必要。表示文言の Noto Serif JP glyph subset |
| 15 | `cd6a1bcbefbffc9c...woff2` | font | 24.0 KiB | 14–17 ms | 必要。表示文言の Noto Serif JP glyph subset |
| 16 | `7d4881bb7e1bf84d...woff2` | font | 23.6 KiB | 3–5 ms | 初期 LCP には不要。Geist Mono latin preload |
| 17 | `1896bb7d54ce0e89...woff2` | font | 22.9 KiB | 11–12 ms | 必要。表示文言の Noto Serif JP glyph subset |
| 18 | `cebea4a751de71ad...woff2` | font | 22.1 KiB | 13–15 ms | 必要。表示文言の Noto Serif JP glyph subset |
| 19 | `7774adb8ba58ad99...woff2` | font | 21.6 KiB | 12–15 ms | 必要。表示文言の Noto Serif JP glyph subset |
| 20 | `2b73c85e22059d73...woff2` | font | 21.6 KiB | 3–6 ms | 必要。footer 等の Noto Serif JP glyph subset |

本番でも font は最大要因で、home `1.019 MB / 35 requests`、login `0.637 MB / 19 requests`。認証済み booking の top 3 は font `114.2 KB`、booking/FullCalendar を含む JS `111.4 KB`、font `108.4 KB`（全 top 20 は raw evidence）。一方、41238 上位 3 JS だけで `9.77 MB` あり、dev-only overhead が lab transfer の大半を占める。

## Render blocking と main-thread blocking

### Render blocking

全 6 lab run で `/_next/static/css/app/layout.css` だけが検出された。

| transfer | Lighthouse estimated blocking |
|---:|---:|
| 281,142 bytes | 1,502 ms |

これは globals、4 font family、booking calendar/section の CSS を root layout に束ねた dev CSS。booking CSS の source 合計は `54,254 raw / 7,675 gzip bytes` で、home と login の初期表示には不要。

### 50 ms 超 long task

| profile | source | median | occurrence | max |
|---|---|---:|---:|---:|
| mobile | `app/layout.js` | 2,639 ms | 3/3 | 2,700 ms |
| mobile | `main-app.js` | 2,095 ms | 3/3 | 2,131 ms |
| mobile | prefetch `app/page.js` | 248 ms | 3/3 | 262 ms |
| mobile | unattributable | 67 ms | 1/3 | 67 ms |
| mobile | document | 66 ms | 1/3 | 66 ms |
| desktop | `app/layout.js` | 2,613 ms | 3/3 | 2,655 ms |
| desktop | `main-app.js` | 2,198 ms | 3/3 | 2,336 ms |
| desktop | prefetch `app/page.js` | 239 ms | 3/3 | 247 ms |
| desktop | unattributable | 64 ms | 2/3 | 64 ms |

Main-thread category median:

| profile | script evaluation | parse/compile | other | style/layout |
|---|---:|---:|---:|---:|
| mobile | 2,912.4 ms | 2,233.0 ms | 225.6 ms | 154.2 ms |
| desktop | 3,008.6 ms | 2,215.2 ms | 303.3 ms | 139.5 ms |

anonymous lab の長時間 task はすべて dev runtime / global layout / home prefetch で、login route chunk 自体ではない。認証済み production booking は mobile `1 件 / 64 ms`、desktop `1 件 / 58 ms` が中央値で、slow sample でも long-task total は最大 `213 ms`。数秒の尾を main-thread blocking では説明できない。

## 予約ページ JS と依存内訳

`46b3464` の `next build --webpack` client reference manifest と実 chunk を gzip level 9 で集計した。build 時の Google font CDN 404 は既存 font cache を task-local fixture として一度だけ与えて解消し、その後の通常 `pnpm build` も green。fixture は JS 内容に関与せず、以下の JS size は production build の実測値。

### 集計

| scope | raw | gzip | 説明 |
|---|---:|---:|---|
| framework/root | 425,612 B | 125,265 B | 全 app 共通 |
| global layout | 367,674 B | 114,552 B | chatbot/nav/font/CSS 関連を含む |
| booking route manifest | 474,828 B | 142,764 B | shared chunk を含む route 表示値 |
| booking-exclusive | 371,638 B | 111,045 B | layout/root と重複しない chunk |
| full initial booking (dedupe) | 1,164,924 B | 350,862 B | 認証済みで booking route を開く場合の local webpack upper set |

P-A-1 の約 `403 KB` は browser が anonymous `/booking` で実際に transfer した値ではなく、以前の build manifest の route 合計だった。現 staging build は `350.9 KiB gzip`、anonymous navigation は login へ redirect するため booking-exclusive `111.0 KiB gzip` を読み込まない。

### chunk / dependency attribution

| chunk | raw | gzip | 主な内容（signature / source import で確認） |
|---|---:|---:|---|
| `0a295304...js` | 120,419 B | 36,623 B | FullCalendar core/react 側 |
| `6798...js` | 188,436 B | 56,545 B | FullCalendar dayGrid/timeGrid/interaction、date-fns、resolver glue |
| `5218...js` | 62,488 B | 17,678 B | BookingCalendar/Form/Confirm/Done を含む app booking implementation |
| `3301...js` | 59,381 B | 16,154 B | Zod。chatbot/global layout と shared |
| `1045...js` | 27,970 B | 8,952 B | lucide-react。layout と shared |
| `2748...js` | 8,701 B | 3,506 B | Next Link。layout と shared |
| `2814...js` | 7,138 B | 3,107 B | shared client runtime |
| `app/booking/page...js` | 295 B | 199 B | route entry |

補助の esbuild metafile で `booking-section.tsx` を依存別に minify attribution すると、FullCalendar core `158,947 raw B`、plugins 合計 `82,466 raw B`、react-hook-form `25,203 raw B`、date-fns `19,776 raw B`、resolver `2,724 raw B`、booking components `60,694 raw B`。Zod は Next の実 chunk `59,381 raw / 16,154 gzip B` を正とする。

### dynamic import 候補

| 候補 | 現状 | 見込み | 判定 |
|---|---|---:|---|
| `BookingForm` + `BookingConfirm` + `BookingDone` | calendar step でも eager import | `12–25 KiB gzip` を form 遷移まで後置 | 第一候補。選択完了時までに prefetch すれば表示/挙動不変を保ちやすい |
| Chatbot engine | root layout で全 route eager | `35–70 KiB gzip` を launcher interaction/idle 後へ後置 | 第一候補。launcher shell を SSR で固定する必要あり |
| FullCalendar 本体 | calendar が初期 step | 最大 `92–111 KiB gzip` | 初期 interaction が遅れるため保留 |
| booking CSS | root layout import | non-booking route から `7.7 KiB gzip` 除外 | 第一候補。booking route で paint 前に同じ CSS を保証する |

## API 寄与

### 41238 canonical-session 3 回

| endpoint / route | median | runs | status / bytes | 判定 |
|---|---:|---|---|---|
| `/api/auth/session` | 16.1 ms | 670.5 / 16.1 / 5.8 ms | 200×3 / 151 B | user ID あり 3/3 |
| exact `/booking` proxy | 36.4 ms | 36.4 / 50.4 / 5.0 ms | 307×3 / 29 B | cookie-name/salt divergence で login redirect |
| `/line/booking` same calendar core SSR | 1,723.3 ms | 11,881.4 / 1,723.3 / 760.9 ms | 200×3 / 136.4 KB | booking markup あり 3/3。cold dev compile/data wait が約 12 s を再現 |
| `/api/teams` | 97.0 ms | 1,226.3 / 97.0 / 35.9 ms | 200×3 / 12 B | 初回だけ 1.23 s |
| `/api/calendar/free-busy` | 6.5 ms | 1,919.0 / 6.5 / 6.2 ms | 200×3 / 14,950 B | miss は `db 38 + oauth 104 + gcal 561 ms`、後続 hit は owner処理 0 ms |
| `/api/chatbot/booking-candidates` | 743.3 ms | 743.3 / 2,053.6 / 649.7 ms | 200 / 5,966 B | booking 初期表示への寄与 0 ms |

### 公開本番 authenticated browser

- `/api/teams`: 6 run の response median `1,473.9 ms`（`1,080.7–3,079.6 ms`）。初期 calendar paint 後だが team selector の準備を遅らせる。
- range change の `/api/calendar/free-busy`: hit/stale median `323.2 ms`、miss/bypass median `1,706.5 ms`、範囲 `865.5–4,596.6 ms`。Server-Timing の重い sample は DB `451–1,493 ms`、GCal `206–756 ms`。
- 初期 SSR も同じ `getCalendarFreeBusyForUser` を Suspense なしで await する。browser API には現れないが、slow navigation の response end / LCP が `4–6 s` まで同期して延びたため、初期 data wait の寄与が実測できた。

## 改善案（効果順）

以下の秒/KB は、今回の chunk/trace/API 実測から置いた実装前 estimate。P-B では実装していない。

| 優先 | 案 | 期待効果 | リスク | 見た目/挙動への影響 | 作業量 |
|---:|---|---|---|---|---|
| 1 | initial free-busy を既存 `BookingMonthSkeleton` の Suspense stream へ分離し、見出し/skeleton を data promise より先に flush | slow production LCP `3.5–5.1 s`、41238 cold core SSR 最大 `約10.2 s` 前倒し見込み。hot medianへの効果は小 | 中。stream/error/auth/cache の回帰 | 同一 skeleton を使えば意図した影響なし | 中 |
| 2 | free-busy miss/bypass を stale-first + background revalidate に寄せ、DB/GCal を request critical path から外す | range API を observed `0.87–4.60 s` から hot `0.17–0.40 s` 帯へ。初期 SSR の長い尾も縮小 | 中〜高。calendar freshness と invalidation を厳密検証 | freshness契約を守ればなし | 中〜大 |
| 3 | `/api/teams` の user-team read を短TTL cacheまたは calendar 後 idle loadへ分離 | browser response median `1.47 s`。team selector ready を最大 `約2 s` 前倒し | 中。招待/脱退直後の整合性 | selector出現時刻に影響し得るため gate 必須 | 中 |
| 4 | performance gate を production build + observed metric に分離し、41238 dev modeled 数値を user timing として扱わない | false overhead `約10.4 MB`、TBT `約4.8 s`、modeled LCP `約10–12 s` を判定から除外。production bytes は 0 | 低 | なし | 小 |
| 5 | Chatbot launcher を静的 shell のまま保ち、engine を interaction/idle import | `35–70 KiB gzip`、低速 CPU `0.1–0.5 s` 見込み | 中。初回 open prefetch と a11y focus を要検証 | 意図した影響なし | 中 |
| 6 | form/confirm/done step を分割し calendar 中に prefetch | 初期 `12–25 KiB gzip`、低速 CPU `0.1–0.4 s` 見込み | 中。transition/focus/draft restore を要回帰 | 意図した影響なし | 中 |
| 7 | booking calendar/section CSS を booking route scope へ移す | home/login `7.7 KiB gzip`、slow profile `0.05–0.20 s` 見込み | 低。FOUC 防止 gate が必要 | なし | 小 |
| 8 | header SVG を pixel-equivalent 最適化 | `10–20 KiB`、実回線 `<0.05 s` 見込み | 低。pixel diff 必須 | なし | 小 |
| 9 | 存在しない forgot-password RSC prefetch を止め、login 中の不要 home prefetch を再評価 | 41238 では `880 KiB` dev transfer と `0.24 s` long task、production は 404 1 件を削減 | 中。home link の次 navigation が遅くなる可能性 | navigation timing に影響し得る | 小 |

## 保留リスト（見た目または挙動へ影響し得る）

| 案 | 期待効果 | 保留理由 |
|---|---:|---|
| Noto JP/Inter/Geist の route-aware preload と static glyph subset | font `0.2–0.8 MB`、slow network `0.3–1.5 s` 見込み | glyph 欠落、fallback、FOUT、CLS が起こり得る。production font は home 1.019 MB / login 0.637 MB なので効果最大だが visual parity gate が必須 |
| FullCalendar 本体を skeleton 後に dynamic import | `92–111 KiB gzip`、slow CPU `0.5–1.5 s` 見込み | calendar の操作可能時刻が遅れ、挙動が変わる |
| animation 削減、layout/文言の簡略化 | 未算定 | 発注の不変条件に直接反する |
| 画像の品質/寸法低下 | 小。home profile image は既に約 25.5 KB | visual quality を変える割に効果が小さい |

## 検証結果

| check | result |
|---|---|
| production navigation | 12/12 success（4 条件 × 3） |
| production authenticated `/booking` | 6/6 HTTP 200、final `/booking`、session authenticated、console/page error 0 |
| 41238 lab navigation | 6/6 success（2 profile × 3） |
| 41238 lab console | 0 error / 6 runs |
| 41238 canonical-session runtime | 15/15 request complete、session/team/free-busy/line calendar HTTP 200; exact `/booking` は再現どおり 307×3 |
| ESLint | pass、error 0 |
| TypeScript | pass、error 0 |
| `next build --webpack` | pass（通常 command の最終 run） |
| Vitest | 162 files / 1,347 tests passed |
| task-created stash | 0（既存の user stash 2 件は保全） |
| authenticated evidence SHA-256 | `fafefc9e5bf513b348dd9a9fc7e49ca812c8f8249a78134a233aeee1d8e13f2b` |

## 未検証

- 41238 exact `/booking` の認証済み browser LCP は、診断済み proxy cookie-name/salt divergence により取得対象が login redirect になるため値なし。exact 公開本番 `/booking` 6 run と、同一 41238 process の canonical-session API + `/line/booking` calendar core で信頼境界を迂回せず補完した。
- 本数値は field RUM / CrUX ではなく、同一 Mac 上の headless Chrome による実回線・実 CPU lab。
- 改善案の秒/KB は実装前 estimate。見た目/挙動不変を確認する実装後 A/B evidence は P-B の scope 外。
