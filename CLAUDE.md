@AGENTS.md

Dev server rule: when a local Next.js dev server is started for verification, do not kill it at session end unless the user explicitly requests shutdown. Preserve the PID and log path for the next verification turn.

## 本番反映ルール（チャットボット・予約カレンダー）

AI チャットボットと予約カレンダーの実装は、検証済み変更を `localhost:41238` だけで止めず、`master` / Vercel Production まで反映し、Production URL と顧客導線で確認できる状態を既定の完了条件にする。破壊的変更、secret / env 更新、DB migration、外部サービス設定変更、不可逆または高コストな操作は、master / Production 反映前にさとしさんの明示確認を取る。

## 41238 最新化ルール

今後この HP の修正が lint・typecheck・対象 unit test を通過し、専用作業ブランチへ commit されたら、報告前に次を実行する。

1. `origin` を fetch し、作業 commit を最新 `origin/staging` 上へ競合なく載せられることを確認する。作業ブランチが遅れているだけなら最新 `origin/staging` へ rebase し、競合が起きた場合は rebase を中止して push せず、さとしさんへ判断を戻す。
2. `origin/staging` が統合後 HEAD の祖先であること、保護対象 baseline の祖先関係、diff allowlist を確認し、通常の fast-forward push だけで `origin/staging` を前進させる。force push / reset / staging 直作業は禁止する。
3. launchd `com.norikane.hp41238` が管理する `.codex-worktrees/staging-live-41238` を新しい `origin/staging` HEAD へ fast-forward し、`launchctl kill SIGTERM gui/<uid>/com.norikane.hp41238` で launchd 管理 job を graceful restart する。KeepAlive による再起動だけを使い、`SIGKILL`、`kickstart -k`、別 port、別 server への置換は禁止する。
4. 新 PID の 41238 LISTEN、配信 worktree HEAD、HTTP 200、`/api/chatbot/build-info` の `commitSha == origin/staging` を確認し、「41238で最新の見た目を確認できます」と報告する。

41238 の更新はローカル確認用に限る。HP デザイン変更の master push / Vercel Production deploy は、さとしさんの明示的な目視 GO が出るまで禁止する。

## ポートポリシー

【ポートポリシー（HP チャットボット / norikane_satoshi_HP 限定・恒久）】本プロジェクトでは 41238 以外のポートをどんな状況でも使用しない。別ポートでの起動・回避・並行検証・フォールバックを含め一切禁止。ただし 41238 が他プロセスで塞がっている場合は別ポートへ逃げず、41238 を塞ぐ原因を安全に除去して 41238 を空ける。grading-verify 等の保護プロセス / launch agent は kill しない。dev サーバー起動は raw next dev の foreground long-lived 直接起動ではなく wrapper cc_notion_web_server.py 経由とする。
