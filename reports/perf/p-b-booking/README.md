# P-B: ホーム / 予約ページ パフォーマンス深掘り分析

- 測定日: 2026-08-12 JST
- 対象ソース: `origin/staging` `46b346403270720f87edb8c58db551bf1bbcbcb5`
- 分析ブランチ: `codex/p-b-booking-analysis-20260812`
- 変更範囲: 本報告書と読み取り専用の測定証跡のみ。機能、UX、UI、文言、レイアウト、アニメーション、アクセシビリティは変更していない。

## 結論

1. 公開本番をスロットリングなしの実回線・実 CPU で測ると、ホームの表示完了中央値は mobile `0.269 s` / desktop `0.279 s`、`/booking` の遷移先ログイン画面は mobile `0.418 s` / desktop `0.387 s` だった。P-A-1 の `12–13 s` は実ユーザー表示完了ではない。
2. P-A-1 と今回の 41238 測定は、`next dev` の巨大な未最適化 bundle を Lighthouse DevTools throttling で評価した値である。41238 の `/booking` は未認証のため `/login?callbackUrl=%2Fbooking` に redirect し、実際の予約カレンダー、FullCalendar、free-busy は初期表示で一度も読み込まれていない。
3. `12 s` の主因はアプリの LCP 要素待ちではなく、dev bundle `10.93 MB`、main-thread blocking `4.75–4.82 s`、Lighthouse の modeled LCP である。trace 上の実測 LCP は同じ 41238 でも `0.178 s` だった。
4. 実配信の残る主要コストは font（ホーム `1.019 MB / 35 requests`、ログイン `0.637 MB / 19 requests`）と global layout の JS/CSS である。厳密な見た目・挙動不変を守れる第一候補は、global client logic と booking 固有 CSS/後続 step の route/step 分割である。

## backend_execution_failed の根本原因と解消

### 確認した原因

同一 discussion の 3 回の失敗は HP アプリ、依存 package、41238 server の障害ではない。前 backend が長い skill 正本を読むために byte-offset の部分読取を生成し、runner の command safety guard が危険操作として backend 全体を終了した。続く診断では、拒否済み command 文字列を含む広域検索と、広い process discovery を追加したため、同じ guard の dangerous / long-lived 分類を再度踏んだ。つまり、最初の不適切な診断 command と、その command 自体を広く検索する再帰的な調査経路が 3 回連続失敗の根本原因だった。

### 今回の解消と再発防止

- skill は行境界を持つ通常の読み取りで全量確認し、byte-offset 読取を廃止した。
- failure 証拠は exact comment / event identity と既知 path に限定し、拒否済み command 文字列を引数へ再注入する広域検索を廃止した。
- 計測、build、test は終了条件のある foreground command のみで実行し、常駐 process を新設しなかった。原因解消と測定中は既存 41238 process を停止・置換していない。
- safety guard の緩和や迂回は行っていない。この実行経路で 18 navigation、API 6 request、build、test を完走し、同障害は再発しなかった。

## Internal repair: 認証済み経路の再監査（2026-08-15）

前回の terminal claim が認証済み予約 runtime 未検証のまま保留されたため、保存済み認証と現行 staging の安全な到達経路を追加監査した。

- `git fetch origin` 後の continuation 開始時点では `HEAD`、`origin/staging`、`git ls-remote origin staging` がすべて `5f797b033cba4d5bf22a3aa6e91c53b77970b054`。これは本報告 commit `f47d407cdcff7479dd5b8e1335eb78ba18b33abf` の子で、差分は LINE 予約 / free-busy 関連 7 files（29 insertions / 25 deletions）のみ。本報告の測定証跡は staging ancestry に残っている。
- 認証専用候補として許可された OpenClaw profile と CC Notion profile を確認したが、どちらも `norikane.studio` の cookie metadata は 0 件。OpenClaw の `DevToolsActivePort` は stale で該当 port に LISTEN はなく、CC Notion の専用 CDP `9223` も LISTEN していなかった。project 内にも Playwright `storageState` / cookie jar / auth-state artifact は 0 件だった。ユーザー Chrome `9222` とその profile は保護境界のため触れていない。
- 現在の 41238 は production-like env（`VERCEL=1`、`VERCEL_ENV=production`）で稼働しており、`/api/dev/auth-bypass` は意図した guard により HTTP `404`、発行 cookie 0 件。Auth.js JWT を直接生成する経路はこの guard と認証境界の迂回になるため使用していない。
- 以上より、保存済み session を使う安全な機械経路は存在しない。公開本番と 41238 の認証済み `/booking` runtime を完測するには、測定用の認証専用 browser profile で各 login URL から `/booking` 到達まで人手認証し、その session を保持した状態が必要である。

## 基準 SHA

`git fetch origin` 後の開始時点で三重突合した。

| 観測 | SHA |
|---|---|
| `git rev-parse HEAD` | `46b346403270720f87edb8c58db551bf1bbcbcb5` |
| `git rev-parse origin/staging` | `46b346403270720f87edb8c58db551bf1bbcbcb5` |
| `git ls-remote origin refs/heads/staging` | `46b346403270720f87edb8c58db551bf1bbcbcb5` |

## 測定方法と判定上の注意

- 各条件は fresh page で 3 回実行し、表は中央値。
- mobile: `390 × 844`, DPR 3, touch。desktop: `1440 × 900`, DPR 1。
- 公開本番: Lighthouse flow `throttlingMethod=provided`。ネットワークと CPU の DevTools throttle は使用せず、trace の observed metric を実測値として採用した。
- 41238: P-A-1 と同じ Lighthouse DevTools throttling。
- 表示完了: Lighthouse trace の `observedLastVisualChange`。INP は指定 interaction（ホームは画像 modal の open/close、ログインは email input click/type）の Event Timing であり、field INP / CrUX ではない。
- Lighthouse audit の `largest-contentful-paint.numericValue` は trace observed LCP と大きく乖離する modeled value だったため、実ユーザー体感判定には observed LCP を使用する。両方を表に残す。
- 保存済みの認証 session は本計測環境になかった。OAuth/login prompt は開いていない。したがって公開本番と 41238 の `/booking` はともにログイン画面の測定であり、認証済み予約カレンダーの runtime LCP/INP は未検証。bundle と API は build/source/P-A-2 証跡で補完した。

Raw evidence:

- `production-unthrottled.json`
- `lab-41238-devtools.json`

## 本番とラボの比較

TTFB は LCP breakdown の `Time to first byte`、表示完了は `observedLastVisualChange`。単位は ms、transfer は decimal MB。

| 環境 / target | profile | final page | observed LCP | INP | CLS | TTFB | 表示完了 | transfer | TBT | Lighthouse audit LCP |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 公開本番 `/` | mobile | `/` | 190 | 88 | 0.000 | 9.3 | 269 | 1.526 MB | 0 | 7,890.8 |
| 公開本番 `/` | desktop | `/` | 174 | 88 | 0.000 | 37.3 | 279 | 1.527 MB | 1 | 5,717.4 |
| 公開本番 `/booking` | mobile | `/login?callbackUrl=%2Fbooking` | 243 | 40 | 0.122 | 131.4 | 418 | 1.120 MB | 1 | 4,664.5 |
| 公開本番 `/booking` | desktop | `/login?callbackUrl=%2Fbooking` | 283 | 40 | 0.122 | 177.4 | 387 | 1.118 MB | 3 | 5,564.2 |
| 41238 `/booking` | mobile | `/login?callbackUrl=%2Fbooking` | 178 | 48 | 0.000 | 53.2 | 1,581 | 10.925 MB | 4,748 | 11,958.1 |
| 41238 `/booking` | desktop | `/login?callbackUrl=%2Fbooking` | 178 | 48 | 0.000 | 47.5 | 1,566 | 10.925 MB | 4,822 | 11,946.5 |

P-A-1 の lab headline はホーム `12.95 s`、予約 `12.00 s`。予約の final URL は今回と同じログイン redirect で、予約カレンダーの測定ではない。P-A-1 の「素材 420 件」は disk inventory であり、初期 network request 数ではない。今回の median request 数は本番ホーム `59`、本番ログイン `46–48`、41238 ログイン `29` だった。

### 実ユーザー体感判定

- 公開本番は、今回の実回線・実 CPU ラボでは「表示完了が 12–13 秒」という症状を再現しなかった。表示完了は全 4 条件で `0.42 s` 未満、TBT は `0–3 ms`。
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
| 41238 booking mobile | login 説明 paragraph | 53.2 | 0 | 0 | 124.5 | 178 |
| 41238 booking desktop | login 説明 paragraph | 47.5 | 0 | 0 | 126.2 | 178 |

`11.95 s` の audit LCP と `0.178 s` の observed LCP が同一 navigation に共存する。LCP element 自身の待ち時間は約 `0.18 s` で、12 秒の原因ではない。

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

本番でも font は最大要因で、home `1.019 MB / 35 requests`、login `0.637 MB / 19 requests`。一方、41238 上位 3 JS だけで `9.77 MB` あり、dev-only overhead が lab transfer の大半を占める。

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

長時間 task はすべて dev runtime / global layout / home prefetch で、login route chunk 自体ではない。production の TBT は `0–3 ms`。

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

### 今回の 41238 計測

| endpoint | 3-run median | runs | status / bytes | 初期表示への寄与 |
|---|---:|---|---|---|
| `/api/chatbot/booking-candidates` | 743.3 ms | 743.3 / 2,053.6 / 649.7 ms | 200 / 5,966 B | 0 ms。booking/login navigation から呼ばれない |
| `/api/calendar/free-busy` anonymous | 4.8 ms | 7.3 / 4.6 / 4.8 ms | 401 / 24 B | 0 ms。auth gate だけで実データを読んでいない |

全 6 lab navigation の `apiRequests` は 0 件。P-A-2 の認証済み canonical evidence は free-busy cache hit `0.009 s`、bypass `0.487 s`。よって認証済み booking SSR では cold/bypass 時に最大約 `0.49 s` の TTFB 寄与があり得るが、`12 s` の説明にはならない。`/api/teams` は hydration 後、calendar refresh は表示範囲変更時に発火するため、本 anonymous trace では未検証。

## 改善案（効果順）

以下の秒/KB は、今回の chunk/trace/API 実測から置いた実装前 estimate。P-B では実装していない。

| 優先 | 案 | 期待効果 | リスク | 見た目/挙動への影響 | 作業量 |
|---:|---|---|---|---|---|
| 1 | performance gate を production build + observed metric に分離し、41238 dev 数値を user timing として扱わない | false overhead `約10.4 MB`、TBT `約4.8 s`、modeled LCP `約10–12 s` を判定から除外。production bytes は 0 | 低 | なし | 小 |
| 2 | Chatbot launcher を静的 shell のまま保ち、engine を interaction/idle import | `35–70 KiB gzip`、低速 CPU `0.1–0.5 s` 見込み | 中。初回 open prefetch と a11y focus を要検証 | 意図した影響なし | 中 |
| 3 | form/confirm/done step を分割し calendar 中に prefetch | 初期 `12–25 KiB gzip`、低速 CPU `0.1–0.4 s` 見込み | 中。transition/focus/draft restore を要回帰 | 意図した影響なし | 中 |
| 4 | booking calendar/section CSS を booking route scope へ移す | home/login `7.7 KiB gzip`、slow profile `0.05–0.20 s` 見込み | 低。FOUC 防止 gate が必要 | なし | 小 |
| 5 | auth 後の free-busy を同一 skeleton の Suspense stream に分離 | cache hit `~0 s`、bypass で shell 最大 `約0.48 s` 前倒し | 中。stream/error/cache の回帰 | skeleton が同一ならなし | 中 |
| 6 | header SVG を pixel-equivalent 最適化 | `10–20 KiB`、実回線 `<0.05 s` 見込み | 低。pixel diff 必須 | なし | 小 |
| 7 | 存在しない forgot-password RSC prefetch を止め、login 中の不要 home prefetch を再評価 | 41238 では `880 KiB` dev transfer と `0.24 s` long task、production は 404 1 件を削減 | 中。home link の次 navigation が遅くなる可能性 | navigation timing に影響し得る | 小 |

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
| 41238 lab navigation | 6/6 success（2 profile × 3） |
| 41238 lab console | 0 error / 6 runs |
| ESLint | pass、error 0 |
| TypeScript | pass、error 0 |
| `next build --webpack` | pass（通常 command の最終 run） |
| Vitest | 162 files / 1,347 tests passed |
| task-created stash | 0（既存の user stash 2 件は保全） |

## 未検証

- 認証済み `/booking` の live LCP/INP、`/api/teams`、range refresh は、上記の保存済み session 3 経路がすべて 0 件で、41238 の dev auth bypass も production guard により 404 のため未検証。認証を迂回せず、対話 login も起動していない。
- 本数値は field RUM / CrUX ではなく、同一 Mac 上の headless Chrome による実回線・実 CPU lab。
- 改善案の秒/KB は実装前 estimate。見た目/挙動不変を確認する実装後 A/B evidence は P-B の scope 外。
