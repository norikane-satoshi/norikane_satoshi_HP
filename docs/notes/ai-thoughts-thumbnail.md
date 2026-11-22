# 「AIで不安になる理由」サムネイル

対象: [Notion IB_ノート](https://app.notion.com/p/41f13ee3141a81b2ab01eefc4eb8c5ab)、slug `ai-thoughts`。

## 候補と推奨

全案、文字・ロゴ・数字・UIのない1600×900 PNG。Codex内蔵画像生成で制作し、寸法だけを `sips` で統一。
背景色は `src/app/globals.css` の `--bg-base` を参照し、暗い周辺と低彩度の暖色で地につなげている。

| 案 | 意図 |
| --- | --- |
| 1 手の届く範囲 | 手元の小さな光と遠い街の灯りで、自分の届く範囲の楽観と、外側への認識を表す。 |
| 2 暗黙知が形になる | 水中でほどける墨の細い形で、言葉にならない知識が形になる過程を表す。 |
| 3 前提を打ち壊す（推奨） | 並んだフィルムから一本だけ立ち上がる曲線で、反復する作業を超える価値創造を表す。 |

推奨は3。小さなカードでも反復と逸脱を読み取りやすく、映画的な静物としてHPと調和する。
これは制作側の推奨であり、本人の採用承認は未了。

リポジトリには `public/notes/thumbnails/ai-thoughts-3.png` だけを収録する。
確認用3案、生成プロンプト、デスクトップ・モバイルのカード表示画像は
`~/tmp/hp-thumb-ai-thoughts/v2/` に保存する。

## 表示経路

- `src/lib/hp/home-notes.ts` の `NOTE_THUMBNAILS["ai-thoughts"]` が画像の正本。
- `src/app/page.tsx` の既存カードが `next/image` で配信する。タイトルは画像外のHTMLで表示する。
- `src/app/notes/[slug]/page.tsx` は公開された対象記事に限り、同じ対応表をOGP・Twitter画像に使う。
- Notionカバーは使わない。記事の公開条件、本文、HPの文言は変更しない。

## 確認方法と会話側の作業

ローカルプレビューは実際のホームページのNotesカードDOMとCSSを使い、ブラウザ内だけで対象カードと候補画像を挿入する。
公開前の記事の比較用表示であり、本番の公開表示や公開後OGPの実配信を確認したものではない。
レビュー画像は `notes-preview-1-desktop.png` から `notes-preview-3-mobile.png`。

1. 3案とカード表示を本人に見せ、採用案を確定する。
2. 別案を選ぶ場合は確認用PNGを `public/notes/thumbnails/` へコピーし、対応表を変更して、3案目を外す。
3. 目視GO後、配線取り込みと画像差し替えの両コミットを通常の統合手順で反映する。
4. 記事公開も承認されたら、対象Notionページの `HP公開` を設定し、既存の再検証経路で `/` と `/notes/ai-thoughts` を更新する。
5. 本番のカード・画像URL・記事の `og:image` / `twitter:image` を読み直す。

この依頼ではpush・staging統合・本番デプロイ・Notion変更を行わない。未統合ブランチとworktreeはレビューのため保持する。
`public/` の画像は、記事が非公開でもデプロイされれば直URLから取得できる。

## 検証

- `pnpm build`、`pnpm typecheck`: 成功。
- `pnpm lint`: エラー0、既存の予約画面2か所の警告のみ。
- `pnpm exec vitest run src/lib/hp/__tests__/home-notes.test.ts src/app/__tests__/home-page.test.tsx tests/unit/notes/fetch-note.test.ts`: 3ファイル・13テスト成功。
- PNG3点の寸法は1600×900。確認用の3案目とリポジトリの画像はSHA-256一致。
- 推奨画像のローカル配信はHTTP 200。
- 表示確認: 1440px幅で2列、390px幅で1列。比較用カードは画像内に文字を置かず、タイトルを既存HTMLのまま表示する。
- プレビュー撮影では固定ヘッダーとチャットボタンを隠し、Notes欄とカードを撮影する。ソースコードや本番UIの変更ではない。
- 検証用サーバー: `http://127.0.0.1:41323`、PID 91013。ログ・検証結果・再撮影スクリプトは確認用画像と同じフォルダに保存。
- 全6表示で画像ロード成功、横はみ出しなし、ページエラー0。元の一覧には対象記事0件、記事URLは非公開表示・`noindex, nofollow`・OGP画像なしを確認。
- 検証後、専用サーバーを停止。検証用の `node_modules` / `.env.local` シンボリックリンクも撤去する。
