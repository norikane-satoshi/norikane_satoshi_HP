# 「AIで不安になる理由」サムネイル引き継ぎ

対象: Notion IB_ノート [AIで不安になる理由](https://app.notion.com/p/41f13ee3141a81b2ab01eefc4eb8c5ab)、slug `ai-thoughts`。

## 画像

| 案 | ファイル | 意図 |
| --- | --- | --- |
| A（推奨） | `public/notes/thumbnails/ai-thoughts-a.png` | 近くの階段だけに落ちる光で、手の届く範囲の楽観と遠方への留保を表す。 |
| B | `public/notes/thumbnails/ai-thoughts-b.png` | 規則的な折りと自由に開く紙の曲線で、自動化と価値創造の二つの使い方を表す。 |

両案ともPNG、1672×941 px（ほぼ16:9）。1600×900で指示した生成出力の実寸を保持。
既存の `correction.webp` は1600×900、外部記事の画像は960×540。
墨色、アイボリー、左側のゴシック調タイトル・右側の絵という既存構成を踏襲。
文字は画像生成によるNoto Sans JP相当の表現で、厳密なフォント埋め込みではない。
既存のタイトル以外のコピーは追加していない。
内蔵画像生成を使用。従量課金の画像APIは使用していない。

確認用の同一PNG:

- `~/tmp/hp-thumb-ai-thoughts/ai-thoughts-a.png`
- `~/tmp/hp-thumb-ai-thoughts/ai-thoughts-b.png`

## 表示経路と変更

- `src/lib/notion/server/fetch-note.ts`: `HP公開=true`、日本語のノートを取得。Notionカバーは読み取らない。
- `src/lib/hp/home-notes.ts`: `NOTE_THUMBNAILS["ai-thoughts"]` にA案のパスを追加。
- `src/app/page.tsx`: 公開ノートをカード化し、`next/image`、`aspect-video`、`object-cover` で一覧表示。デスクトップ2列、スマートフォン1列。PNGはNext.jsの画像最適化経路で配信する。
- `src/app/notes/[slug]/page.tsx`: 公開された `ai-thoughts` に限り、同じ対応表の画像をOpen GraphとTwitterに指定。ほかのノートのOGPは変更しない。
- 非公開記事の本文・画像メタデータを公開する処理や、記事本文の先頭に画像を表示する処理は追加していない。

## 会話側で反映するとき

1. 則兼さんにA/Bを確認してもらう。Bを選ぶ場合は `NOTE_THUMBNAILS["ai-thoughts"]` の末尾を `ai-thoughts-b.png` に変えるだけで、一覧とOGPの両方が切り替わる。
2. この作業コミットを通常の統合手順で取り込み、目視GO後に本番へ反映する。未採用案を公開URLに置きたくなければ、そのPNGは確認用コピーを残して本番反映の対象から外す。`public/` 内の画像は記事が非公開でも、デプロイ後は直URLから取得できる。
3. 記事公開の承認が出た時点で、対象Notionページの `HP公開` をYESにする。カバーの設定は不要。画像をNotionカバーに設定するだけではHP一覧には出ない。
4. 既存のNotion→HP再検証経路で `notes` タグ、`/`、`/notes/ai-thoughts` を更新する（`src/app/api/revalidate/route.ts`）。独自の公開バイパスや新しい認証設定は不要。
5. 本番の `/#philosophy` のカード、`/notes/ai-thoughts` の `og:image` / `twitter:image`、画像URLが200で取得できることを確認する。

今回の作業ではpush、staging統合、本番デプロイ、Notionの書き換えは行っていない。未統合の作業ブランチ・worktreeをレビュー用に保持する。

## 検証

- `pnpm build`、`pnpm typecheck` 成功。
- `pnpm lint`: エラー0。既存の予約画面2か所に警告あり。
- `pnpm test -- src/lib/hp/__tests__/home-notes.test.ts tests/unit/notes/fetch-note.test.ts`: この呼び出しでは対象指定が効かず全体が実行され、1886 passed / 12 skipped。追加の再実行はしていない。
- ローカルの本番ビルドを1440px / 390px幅で表示し、既存カードのDOM複製へ2案を挿入した確認用表示を検査。2列 / 1列、画像ロード成功、横はみ出しなし。これは公開済み表示の証跡ではない。
- 元の一覧には `ai-thoughts` が0件。記事URLは「このノートは現在公開していません」、`noindex, nofollow`、`og:image` 0件。公開判定を維持。
- 両PNGのローカル配信はHTTP 200。確認用コピーとGit対象画像のSHA-256が一致。
- 公開後のOGPの実配信とSNS側の表示確認は、公開承認後の反映担当が行う。

表示確認の保存先: `/Volumes/8TB_RAID00/10_業務・開発・セミナー/20_AI開発/norikane_satoshi_HP/検証/ai-thoughts-thumbnail-20261122/`。
検証サーバーは `http://127.0.0.1:41322`、PID 85284、ログは同フォルダの `server.log`。検証後に停止済み。

## 生成プロンプト

### A

```text
Use case: stylized-concept. Create a finished editorial thumbnail for a Japanese colorist's essay, landscape 16:9, requested 1600x900 PNG. Premium restrained noir design. Almost black ink ground #0D0C0B, ivory #ECE6DC and warm gray only, subtle matte paper/mineral textures, carefully controlled soft studio lighting. Left 45 percent typography, right 55 percent conceptual still-life. Very generous negative space, safe margins 6 percent. EXACT Japanese title in two lines: first line "AIで不安に", second line "なる理由". Large exceptionally legible ivory Japanese Gothic sans-serif similar to Noto Sans JP semibold, clean real Japanese glyphs, around 70 pixels at 1600 wide. Title is placed at left around vertical middle and readable at a small card size. No other text whatsoever. No logos, artist names, program names, school names, product names, subtitles, labels, borders or watermarks. No robot faces, glowing brains, circuit boards, neon, red, warning effects, blue tech gradients. Avoid a generic AI poster. Make a sophisticated thoughtful editorial artwork, quiet curiosity and measured optimism, not fear or danger. Scene: on the right a miniature abstract architectural space made of dark charcoal matte planes, three shallow broad steps illuminated only nearby by a narrow off-frame opening. A small wedge of soft warm ivory daylight falls across the near steps; the far space remains undefined and gently dark. No bright doorway into heaven, no tall ladder, no people. Clear beautiful geometric composition, one softly lit reachable area against an unknown distance. This illustrates optimism about what is within one's reach while acknowledging what lies beyond. Restrained realistic material presence, no hard glow. The architectural space is confined to the right half; left stays nearly flat ink behind title.
```

### B

```text
Use case: stylized-concept. Create a finished editorial thumbnail for a Japanese colorist's essay, landscape 16:9, requested 1600x900 PNG. Premium restrained noir design. Almost black ink ground #0D0C0B, ivory #ECE6DC and warm gray only, subtle matte paper/mineral textures, carefully controlled soft studio lighting. Left 45 percent typography, right 55 percent conceptual still-life. Very generous negative space, safe margins 6 percent. EXACT Japanese title in two lines: first line "AIで不安に", second line "なる理由". Large exceptionally legible ivory Japanese Gothic sans-serif similar to Noto Sans JP semibold, clean real Japanese glyphs, around 70 pixels at 1600 wide. Title is placed at left around vertical middle and readable at a small card size. No other text whatsoever. No logos, artist names, program names, school names, product names, subtitles, labels, borders or watermarks. No robot faces, glowing brains, circuit boards, neon, red, warning effects, blue tech gradients. Avoid a generic AI poster. Make a sophisticated thoughtful editorial artwork, quiet curiosity and measured optimism, not fear or danger. Scene: on the right, a gallery-like still-life of two continuous narrow ivory paper ribbons on a dark charcoal matte surface. One ribbon is folded into a precise short sequence of identical low accordion pleats, representing automation; beside it the other ribbon opens into one elegant spacious sculptural loop with a free tip, representing curiosity and creation. Both ribbons are tactile and realistic, with fine paper fiber and delicate soft natural shadows. Minimal museum art direction, composition immediately legible as repetition versus a new form, no charts or arrows. Keep sculpture entirely on right half; left stays nearly flat ink behind title.
```

