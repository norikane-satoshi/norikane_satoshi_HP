# Repository hygiene

このリポジトリでは、整理を後日の一括作業にせず、各実装の lifecycle に含める。

## 通常の作業

1. Main checkout の `master` を `git fetch origin && git merge --ff-only origin/master` で最新化する。
2. 実装ごとに専用 branch / worktree を使う。
3. 最小テスト、影響範囲テスト、実アプリ確認を順に行う。
4. 統合後、open handle がない clean な task worktree と local branch を同じ発注内で削除する。
5. `pnpm repo:hygiene -- --strict` を通して完了する。

Claude Code は Stop hook で同じ検査を行う。CI は静的ポリシーと検査ロジックの回帰テストを行う。

`staging-live-41238` と `grading-verify` は用途を持つ保護 worktree なので、自動削除の対象外とする。dirty な task worktree は別セッションの作業中か中断状態かを人が判断し、検査は警告だけを出す。自動 cleanup はファイルを削除しない。

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
