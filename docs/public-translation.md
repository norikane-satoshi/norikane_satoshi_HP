# 公開ページの翻訳

日本語のページ・データ・Notion が正本。訳文は Upstash Redis に保存し、リポジトリには置かない。対象言語と公開 URL は `src/lib/i18n/locales.ts`、用語・文体・モデル・翻訳版は `src/lib/i18n/instructions.ts` を正本とする。

## 配信と生成

日本語の画面は `src/app/(ja)` に置き、URL は変えない。日本語の root layout と言語別 catch-all の root layout は `site-layout.tsx` を共有する。言語・公開パスはルート params から取得し、ページと layout は headers・cookies・searchParams を読まない。日本語ページは従来の静的配信・ISR、言語別ページは空の generateStaticParams、force-static、60 秒の ISR により初回アクセス時に生成し、以降はキャッシュを返す。Redis SDK の no-store fetch が実行時にページを動的描画へ切り替えないよう force-static を明示する。Redis の読み取り自体はキャッシュせず、ページの生成・再検証時に最新の訳を読む。独自の Vary や生成指示ヘッダーは使わない。

未生成のページは日本語・`lang=ja`・noindex。公開済みの訳があれば、原文の編集や翻訳版の更新中も index と対象言語を維持する。訳がない新しい文だけ原文で表示する。ナビ・フッターは共通文書 `@shell` として本文から分離する。

翻訳は本番（`VERCEL_ENV=production`）でだけ、ページ生成後の after() で不足分を生成・照合する。preview とローカルは保存済みの訳を使うだけで Gemini を呼ばない。新しい文・編集した文は、同じ原文が 24 時間変わらなかったことを確かめてから訳す。編集途中の文に料金を払わないため。言語別ページはビルド時に生成しないため、ビルドは翻訳 API に依存しない。

クエリ付き言語 URL はクエリを保持し、クエリなしの URL と同じ ISR キャッシュを返す。クエリの違いによる生成・翻訳・保存は行わない。言語別の catch-all は `src/app/i18n/[locale]` に置き、proxy が対応言語の公開 URL だけを内部 rewrite する。言語別ノートの公開有無は既存のキャッシュ付き公開一覧で判定する。存在しないノートと未公開ノートの言語別 URL は、内部 URL への直接アクセスと同じく、proxy が `global-not-found.tsx` の出力へ rewrite する。ステータス 404 と日本語のナビ・フッターを初回の HTML で返す。未対応言語と公開ページ以外も同じ共通 404 を使う。

## 訳の寿命と更新

`service.ts` は言語・明示の翻訳版ごとに原文から訳文への共通辞書を持つ。同じ原文は全ページで同じ訳を使い、原文が変わらなければ再翻訳しない。文書キーは言語と正規パスで固定し、最後に完成した訳のスナップショットを保持する。辞書と文書スナップショットには TTL を付けない。TTL があるのはロックと失敗後の待機だけ。

原文の編集時は共通辞書にない文だけを API に渡す。文書全体も読み取り専用の文脈として渡すが、出力は不足分だけに限定する。翻訳と原文照合の 2 回を検証してから共有辞書と文書を更新する。既存の文の言い回しは変えない。

`TRANSLATION_VERSION` を上げると全ページ・全言語を作り直すので、モデルの変更など全面的な更新のときだけ上げる。個別の誤訳は、保存済みの該当する訳だけを直す。指示文の編集そのものでは既存訳を無効にしない。新版の必要な文が揃うまで前の文書の訳を返し、失敗時にも前の訳を保持する。

モデル全体の所有者付きロックで生成を 1 件に制限し、取得後にも保存状態を再確認する。通常の失敗は同じ文書・版・原文について 5 分、1 時間、12 時間、6 日と間隔を広げて再試行し、続けて失敗しても月 5 回までに抑える。Gemini から HTTP 402（前払い残高切れ）、または quotaId に PerDay を含む HTTP 429 が返った場合は、モデル共通の待機キーを 24 時間保持し、別ページ・別言語からも再試行しない。再試行待ちでも公開済みの訳は維持する。

初稿と照合はそれぞれ Flex で開始し、クライアントに 610 秒のタイムアウトを設定する。Gemini が HTTP 503 を返した段階だけ `PUBLIC_I18N_FALLBACK` を記録し、同じ内容を標準料金で 1 回だけ送り直す。標準の上限は 380 秒で、その段階の開始から 875 秒以内に収める。Gemini 側にもクライアントより 10 秒短い期限を指定する（Flex は 600 秒）。通信タイムアウトや残高・クォータのエラーは既存の再試行待ちへ進む。Vercel 関数の実行枠は初稿・照合・保存を含めて 1,800 秒。生成ロックは 1,900 秒で、完了時には解放する。[Gemini の Flex 仕様](https://aistudio.google.com/docs/flex-inference)・[Vercel の実行時間仕様](https://vercel.com/docs/functions/configuring-functions/duration#extended-max-duration)

応答ごとのトークン数、リクエストの `requestedServiceTier`、Gemini が返した `usageMetadata.serviceTier` を `PUBLIC_I18N_USAGE` に記録する。応答に料金区分がなければ `serviceTier` は `null`。本番で次に翻訳が生成されたら、Vercel の Runtime Logs で同じ実行の `draft` と `review` の `serviceTier`、`PUBLIC_I18N_COMPLETE` を確認する。

## 描画と安全性

サーバーの React 要素を文・段落単位で集め、リンクと強調を番号付きの目印として保持する。client component は `scripts/i18n/loader.cjs` が文字・式を直接持つ要素とリンクだけを翻訳境界へ通す。サーバー要素やコンテナを一律に包まない。追加 DOM を出さず、日本語を解析するロジックへ訳を渡さない。Biography はリンク付きの段落全体を扱う。文字列一覧はビルド時に日本語ソースから自動生成する。

訳は React の文字列として描画し、HTML として挿入しない。リンク先・画像・属性は原文から復元し、JSON-LD は `<` をエスケープする。任意文を受け付ける翻訳 API は公開しない。鍵はサーバー側のみで使い、ログには値を残さない。設定不足・API エラーは PUBLIC_I18N のログに記録する。Vercel sensitive 値はローカルに取得せず、ストアの単体テストはメモリで行う。

フッターの全言語リンクと原文リンクは正規 URL の a 要素。言語別フッターには検証済みのルート params から正規パスを渡し、配信アダプター内の catch-all パスのエンコードに依存させない。クリック時に固定言語を検証し、言語コードだけの cookie を Secure・SameSite=Lax・Path=/ で保存する。HttpOnly は付けない。proxy の対象は公開ページと言語別 URL、従来の `/booking` 配下に限定し、画像・API・静的アセットを対象にしない。booking のトークン認証は保持し、言語付き予約 URL は 404。転送先は固定言語と公開パスだけから組み立てる。

## 検証

- `pnpm exec vitest run tests/unit/i18n tests/unit/hp/seo.test.ts`
- `pnpm typecheck`、ESLint、`pnpm exec next build`（Vercel と同じ Turbopack）
- ビルド後に `node scripts/i18n/verify-isr.mjs <検証保存先>`。ローカル Redis 代替 HTTP サーバーで SDK の no-store 通信を通し、初回生成後のクエリ違いとクエリ付き初回アクセス後の正規 URL が同じキャッシュを使い、HIT・Redis 読み取り増分 0・書き込み 0・キャッシュファイルの追加 0 になることを確認する。外部翻訳 API は呼ばない。
- staging の実レスポンスで日本語の事前生成、言語別ページのキャッシュ、予約保護、正規リンク、noindex と lang を確認する。
- 訳は本番でだけ生成されるので、新しい訳の通読と図の可読性確認は本番で行う。
