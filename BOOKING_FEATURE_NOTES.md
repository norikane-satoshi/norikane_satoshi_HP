# HP 予約カレンダー機能 実装ノート

このファイルは HP 本体（norikane_satoshi_HP）に予約カレンダー機能を実装する Phase 1 スキャフォールドの位置付けを示す。詳細仕様は Notion タスクページ「HP 予約カレンダー機能の方針確定と実装」を参照。

## 全体方針

- 認証：Auth.js (NextAuth v5)
  - Credentials（メール + 自前パスワード、bcrypt）
  - OAuth：Google / X (Twitter) / LINE / Microsoft（Apple は屋号「のりかね映像設計室」開業 + Apple Developer Program 加入後に追加）
- データ：Turso（libSQL）+ Prisma 7。colorist-scheduler とは別 DB を作成する
- カレンダー連携：Google Calendar API（Free/Busy 取り込み + 予約イベント書き込み）
  - Free/Busy 読み取りは cc-notion 系 Service Account `gcal-sync@cc-notion-gcal.iam.gserviceaccount.com` を流用（「智志仕事」カレンダーを当該 SA に共有設定する運用）。`.env` には `GOOGLE_CALENDAR_SA_KEY_PATH=~/.openclaw/gcal-sync-sa.json` を投入し、Vercel には同 SA 鍵を Base64 で別 env に積む
  - ユーザーログイン用の Google OAuth（`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`）は HP 用に新規発行し、SA 経路とは独立並走する
  - 既存の cc-notion `/gcal-sync` 経路（IB_仕事 ⇔ 「智志仕事」双方向同期）の流用検討余地あり
- 予約 UI：colorist-scheduler の `src/lib/calendar-utils.ts` / `week-calendar-utils.ts` / `booking-colors.ts` / `holidays.ts` / `validators.ts` を移植して HP 仕様に調整
- 表示モード：月（俯瞰）/ 週（縦軸 = 時間）切替。週表示は `DEFAULT_WEEK_START_MINUTE = 8 * 60` / `DEFAULT_WEEK_END_MINUTE = 20 * 60` を踏襲

## 仮キープ機能仕様（GCal 書き込みあり）

- 仮キープは予約枠の「ソフトロック」として機能する
- **GCal にも仮キープイベントを書き込み**、さとし本人のカレンダー上で「この時間に仮キープが入っている」と一目で分かる状態にする
- 仮キープと本予約は GCal 上で色分け（仮キープ = フラミンゴ等）またはタイトル prefix（`【仮キープ】〇〇さん予約` / `【予約確定】〇〇さん予約`）で区別する
- 仮キープが他客の本予約で上書き or 自発キャンセルされた場合は GCal 側のイベントも削除 or タイトル・色を更新する
- 仮キープ中の枠でも他顧客は本予約申込が可能。申込が入った瞬間、仮キープ客に通知メール、3日以内に本予約化または応答が必要。3日経過で後着の本予約客に上書きされる
- 決済を絡める場合は「決済オーソリ → 3日後キャプチャ」フローで返金リスクを避ける

## Phase

Phase 1（このスキャフォールド）：Auth.js + Prisma の最小スキーマ。`.env.example` 整備、`prisma/schema.prisma` 初版（Auth.js 標準 + Customer + Booking + 仮キープ用フィールド + gcalEventId）

Phase 2：Auth.js Credentials + Google Provider のローカル動作（サインアップ → メール所有確認 → ログイン → セッション維持）

Phase 3：Google Calendar Free/Busy 取り込みプロトタイプ（「智志仕事」の busy 時間を予約 UI でグレーアウト）

Phase 4：予約 UI（月 / 週切替、colorist-scheduler 流用）

Phase 5：仮キープ機能（DB 状態遷移 + 3日タイマー + 通知メール + 決済オーソリ → キャプチャ + GCal 仮キープイベント書き込み・更新）

Phase 6：残 OAuth Provider 追加（X / LINE / Microsoft）

Phase 7：本番反映 + E2E

Phase 8（後追い）：Apple Sign In 追加（屋号開業 + Apple Developer Program 加入後）

## ニューモーフィズム規則の順守

ログイン UI、予約カレンダー UI とも HP リポジトリ AGENTS.md「ニューモーフィズム品質3層」の枠内で組む。FullCalendar の標準テーマや shadcn のデフォルトテーマはそのまま使わず、CSS 変数で `neu-raised` / `neu-raised-sm` / `neu-inset` の影に置き換える層を作る。月／週切替タブは通常 = `neu-flat` / 選択中 = `neu-inset`。

## Next.js 16 の破壊的変更

実装着手時は `node_modules/next/dist/docs/` の該当ガイドを必ず確認。`params` / `searchParams` は Promise 型で `await` する、`revalidateTag(tag, profile)` の第2引数推奨、Auth.js v5 の `auth()` ヘルパー呼び出し位置の調整など。

## 関連

- Notion タスクページ：HP 予約カレンダー機能の方針確定と実装
- 流用元：colorist-scheduler（github.com/norituku/colorist-scheduler）
- HP 本体：github.com/norituku/norikane_satoshi_HP
- 屋号：のりかね映像設計室（英文表記：Norikane Film Design Office、契約・税務上の代表者表記：則兼智志）
