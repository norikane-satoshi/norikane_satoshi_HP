@AGENTS.md

Dev server rule: when a local Next.js dev server is started for verification, do not kill it at session end unless the user explicitly requests shutdown. Preserve the PID and log path for the next verification turn.

## Local dev server protection（絶対遵守、違反は重大インシデント扱い）

のーちゃん／さとしさんから明示指示が無い限り、以下を厳守する：

- LISTEN 中のローカル dev server を stop / kill / restart / port 閉鎖しない。
- 検証目的でも実装変更目的でも、LISTEN 中の wrapper / node プロセスに SIGTERM / SIGKILL / pkill / wrapper stop コマンドを送らない。
- セッション終了時・タスク完了時も dev server を kill しない（「片付け」と称した kill 禁止）。
- LISTEN なしの場合のみ wrapper restart 可。restart 時は ttl_sec 上限（現行 `cc_notion_web_server.py` は 3600 にクリップ）を尊重。
- 完了報告送信直前に `/usr/sbin/lsof -nP -iTCP:<対象 port> -sTCP:LISTEN` を実行し、LISTEN 継続を確認して出力を完了報告に貼る。
- 「LISTEN 継続」と報告した後にプロセスを kill しない。報告内容は次セッションまで保持される事実として扱う。
- 該当 port（現行 HP grading-verify 検証ポートは 41238）は他用途で奪わない。
- 違反が検知された場合、次の発注以降の冒頭に違反履歴として再掲され続ける。
