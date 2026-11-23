# 公開ページの翻訳

日本語のページ・データ・Notion が原文。訳文は Upstash Redis に保存し、リポジトリには置かない。対象言語・公開 URL の許可リストは `src/lib/i18n/locales.ts`、用語・文体・モデルは `src/lib/i18n/instructions.ts` が正本。

`next.config.ts` は日本語ソースの文字列一覧を生成し、公開ページの JSX だけを `scripts/i18n/loader.cjs` で `TranslationBoundary` に通す。追加 DOM は出さず、日本語では元の要素を返す。日本語を解析する処理やデータには訳を渡さない。公開コンポーネントを通常どおり日本語で追加でき、文字列ごとの翻訳関数は不要。Biography のリンク付きデータは段落として組み立てる。

`documents.tsx` がサーバーの要素を解決し、リンク・強調を番号付きの目印で保持した文を文書単位で集める。原文・指示・モデルのハッシュが変われば別のキャッシュになる。未公開ノートは原文取得時に止め、Redis に触れない。公開ページ以外・未対応言語は対象にならない。

キャッシュがない言語 URL は日本語と noindex を返す。クエリのない正規 URL のリクエスト後に `after()` で生成を開始し、翻訳→原文と照合して修正の 2 回が成功してから公開する。Redis の所有者付きロックで重複生成を防ぎ、モデル全体でも同時に 1 文書だけ生成する。他の文書の生成中は、次の正規 URL へのアクセスで再試行する。失敗はログと 5 分の再試行間隔を残す。ビルド時に翻訳 API は呼ばない。

Vercel の sensitive 環境変数は pull すると空になるため、Redis の実接続は Preview で確認する。単体テストにはメモリ上の保存先を渡す。設定不足・API エラーは `[PUBLIC_I18N_*]` のログに残り、値は記録しない。翻訳 API を公開するルートはない。

訳文は React の文字列として描画する。リンク・属性は原文から復元し、構造化データでは `<` をエスケープする。自動振り分けと手動選択は公開 URL と固定言語だけを扱う。予約ページは翻訳対象外。手動選択の cookie は Secure・HttpOnly・SameSite=Lax。

`headers()` で proxy の検証済み言語をルート layout に伝えるため、ページはリクエスト時描画になる。Notion の取得キャッシュは既存のものを使う。Next のルート params は子ルートの言語を layout に渡さないため、この方法で日本語ページの移動を避けている。

## 確認

- `pnpm exec vitest run tests/unit/i18n tests/unit/hp/seo.test.ts`
- `pnpm typecheck`、変更範囲の ESLint、`pnpm build`
- `node scripts/i18n/model-check.mjs <結果JSON>`: 既存のローカル Gemini 設定でモデル一覧と翻訳サンプルを取得する。
- `node scripts/i18n/verify.mjs <staging URL> <検証保存先> [--warm] [パス...]`: 認証済み Vercel CLI の保護迂回を使い、HTML・ヘッダー・本文・メタデータを保存する。パス省略時は 8 言語 × トップ・correction・ai-thoughts・privacy・terms。`--warm` は各文書を順に生成し、翻訳済みになるまで取得する。

未生成の確認と生成後の確認を区別する。法務の正本表示・ノートの自動翻訳表示・フッターの切替を含め、画面の確認を受けるまで master / Production に進めない。
