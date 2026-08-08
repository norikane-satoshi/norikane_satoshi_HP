# Repository hygiene

このリポジトリでは、整理を後日の一括作業にせず、各実装の lifecycle に含める。

## 通常の作業

1. Main checkout の `master` を `git fetch origin && git merge --ff-only origin/master` で最新化する。
2. 実装ごとに専用 branch / worktree を使う。
3. 最小テスト、影響範囲テスト、実アプリ確認を順に行う。
4. 統合後、main checkout から `repo:finish` の dry-run と apply を実行し、open handle がない clean な task worktree、local branch、同名の origin branch を同じ発注内で削除する。
5. `pnpm repo:hygiene -- --strict` を通して完了する。

Claude Code は Stop hook で同じ検査を行う。CI は静的ポリシーと検査ロジックの回帰テストを行う。

`staging-live-41238` と `grading-verify` は用途を持つ保護 worktree なので、自動削除の対象外とする。dirty な task worktree は別セッションの作業中か中断状態かを人が判断し、検査は警告だけを出す。自動 cleanup はファイルを削除しない。

## Task branch の終了

`repo:finish` は一度に明示した1ブランチだけを扱う。まず main checkout の `master` で dry-run する。

```sh
pnpm repo:finish -- codex/example-task --target=origin/master
```

出力された branch、commit、統合先、worktree、local/origin branch の対象が正しい場合だけ apply する。staging までの統合で終了する作業は `--target=origin/staging` を使う。

```sh
pnpm repo:finish -- codex/example-task --target=origin/master --apply
```

apply は次の条件をすべて満たさなければ何も削除しない。

- main checkout が clean な `master` で、`master == origin/master`
- 対象 branch の local/origin 先端が一致し、指定した `origin/master` または `origin/staging` の祖先
- task worktree が `.codex-worktrees/` または `.claude/worktrees/` 内にあり、clean で open handle がない
- `master` / `staging` ではなく、構文上有効な明示 branch 名

実行時は対象 worktree、同名 origin branch、local branch の順に削除し、全対象の不在を再確認する。remote の削除には確認済み先端への lease を付け、確認後に進んだ branch を削除しない。`repo:hygiene -- --strict` は、worktree を外したあとに残った統合済み local branch もエラーにする。歴史的な branch を一括削除する用途には使わない。

## ローカル専用領域

次の領域は Git 管理外とし、用途を `.gitignore` に明記する。

- `.agents/`, `.claire/`, `.claude/worktrees/`, `.codex-worktrees/`: agent / runtime state
- `skills-lock.json`: ローカル skill 解決状態
- `design-mockups/_candidates/`: review 前の生成候補
- `sozai/`: 公開リポジトリに含めない制作素材

未分類の untracked file は、追跡・明示的 ignore・復旧 branch への退避のいずれかをその場で選ぶ。

## Vercel environment variables

Vercel の Encrypted 値は `vercel env pull` の出力で空になることがある。raw pull で `.env.local` を上書きしてはならない。

```sh
pnpm env:pull:safe -- --environment=production
```

このコマンドは一時ファイルへ取得し、pull 結果が空の項目について既存の非空ローカル値を保持する。カレンダー、認証、Turso の必須値が最終的に空なら `.env.local` を書き換えず失敗する。値そのものはログへ出さない。

必須値を失った場合は Bitwarden 等の正本を unlock して復元する。placeholder、別用途の credential、アプリ側 fallback は使わない。
