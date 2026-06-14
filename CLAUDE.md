@AGENTS.md

Dev server rule: when a local Next.js dev server is started for verification, do not kill it at session end unless the user explicitly requests shutdown. Preserve the PID and log path for the next verification turn.

## 本番反映ルール（チャットボット・予約カレンダー）

AI チャットボットと予約カレンダーの実装は、今後すべてローカルホスト http://localhost:41238/（＝http://127.0.0.1:41238）で全部確認し、さとしさんが承認してから本番に反映する。ローカルで確認・承認していない変更は、master への push 経由の Vercel auto-deploy を含め本番（Production）へ一切出さない。検証は別ポートを増やさず 41238 に集約する。

## 41238 最新化ルール

今後この HP のコードを修正したら、報告前に必ず `localhost:41238` をその修正が反映された最新状態へ更新し、さとしさんがすぐ目視確認できる状態にする。必要なら `cc_notion_web_server.py` wrapper 経由で 41238 の再起動・再ビルドを行ってよい。従来の「41238 は停めない・再起動しない」保護ルールより、この最新化ルールを優先する。

維持する安全線: push / master 反映 / Vercel Production deploy は、さとしさんの目視 GO が出るまで禁止。41238 の更新はローカル確認用に限る。

## ポートポリシー

【ポートポリシー（HP チャットボット / norikane_satoshi_HP 限定・恒久）】本プロジェクトでは 41238 以外のポートをどんな状況でも使用しない。別ポートでの起動・回避・並行検証・フォールバックを含め一切禁止。ただし 41238 が他プロセスで塞がっている場合は別ポートへ逃げず、41238 を塞ぐ原因を安全に除去して 41238 を空ける。grading-verify 等の保護プロセス / launch agent は kill しない。dev サーバー起動は raw next dev の foreground long-lived 直接起動ではなく wrapper cc_notion_web_server.py 経由とする。
