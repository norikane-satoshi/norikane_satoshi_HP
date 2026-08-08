# Notion AI スレッドの巻き直し

Tier1 の hosted worker は、常時開いた 1 枚の Notion AI ページのスレッドを使う。
スレッド ID は `CHATBOT_HOSTED_WORKER_NOTION_THREAD_URL`（VPS）と
`src/lib/chatbot/hosted-worker/notion-ai-config.ts` の既定値で固定している。

## なぜ巻き直しが要るか

Notion は `runInferenceTranscript` のやり取りをスレッドへ永続化する。
`saveAllThreadOperations: false` を送っても永続化は止まらない（2026-08-07 実測）。
つまりスレッドは必ず育ち、いつか Notion の容量上限に達する。

上限に達すると Notion は推論の代わりに `Column size exceeded` を
アシスタントの本文として返す。`22bfa37` 以降これは生成失敗として扱われ、
顧客には見えず下位 Tier へ落ちるが、**Tier1 は復旧しないので巻き直しが必要**。

同じ理由でスレッドには全顧客の会話が混在する。履歴が積もるほど、
ある相談への応答に別の相談の内容が混ざるリスクが上がる（CB-ERR-016）。

## 育つ速さ

支配的なのは顧客の相談ではなく heartbeat の generate smoke。

| 発生源 | 既定の頻度 | 1 日あたりのターン |
|---|---|---|
| heartbeat の generate smoke | `CHATBOT_HOSTED_TIER1_HEARTBEAT_GENERATE_INTERVAL_MS=600000`（10 分） | 約 144 |
| 顧客の相談 | 実績で 1 日数件 | 数件 |

2026-08-07 の実測では 24 時間で heartbeat 由来が 85 回。
smoke の間隔を延ばすとスレッド寿命はそのぶん延びるが、
generate 固有の障害の検知が遅れる。間隔を変えるときはこのトレードオフを明示する。

## 巻き直し手順

前提: Tier1 が `Column size exceeded` を返す、または混入が観測された。

1. **新しいスレッドを作る。** worker の Chrome（CDP `127.0.0.1:9223`、
   ページは `app.notion.com/chat`）で次を順に行う。Enter だけでは送信されない。
   - `innerText` が `新規チャット` の要素（最も深い一致。ショートカットは `Ctrl+O`）をクリック
   - `[contenteditable='true'][role='textbox']` へ CDP `Input.insertText` で 1 文字以上入力
   - `aria-label="AIメッセージを送信"` のボタンをクリック
   - URL が `app.notion.com/chat?t=<新ID>` になるので `t` を控える

   クライアントで採番した UUID は推論 API に拒否されるので、必ずこの手順で
   Notion 側に発行させる（`48bae9c` で試して Tier1 が落ちた）。

2. **設定を差し替える。**
   - VPS: `~/.config/norikane-hosted-worker/worker.env` の
     `CHATBOT_HOSTED_WORKER_NOTION_THREAD_URL=https://www.notion.so/chat?t=<新ID>`
     （変更前に必ずバックアップを取る）
   - repo: `notion-ai-config.ts` の `defaultNotionAiChatbotThreadUrl` と
     `notionAiChatbotThreadId`

3. **worker を再起動して確かめる。**
   `systemctl --user restart hosted-notion-ai-worker.service` のあと、
   `/health` が `targetUrlMatches: true`、`/generate` が `rawText` を返すこと。
   巻き直し直後は履歴が無いぶん応答が速い（実測 28〜60 秒 → 8〜26 秒）。

4. **混入していないことを確かめる。**
   無関係な初回相談を連続で 2 件送り、後の応答に前の会話の案件情報
   （尺・追加作業・媒体など）が出ないことを確認する。

## 自動巻き直し（実装済み）

worker は `Column size exceeded` を検知すると、上の手順を自分で実行して新しい
スレッドへ移り、そのリクエストを 1 回だけ再試行する。手で巻き直す必要があるのは
自動巻き直しが失敗したときだけ。

- 発火は容量エラーだけ。`Internal server error` や `Something went wrong` では
  巻き直さない（Notion 側の一時障害で、チャットを増やしても直らないため）
- 新しいスレッドは `~/.local/state/norikane_satoshi_hp/hosted-worker-notion-thread.json`
  へ保存され、worker 再起動後もそこを使う。保存は再試行より先に行う
- 実効スレッドの優先順は **保存済みの巻き直し結果 > env > repo 既定値**。
  設定こそが容量切れのスレッドを指していた側なので、巻き直しが勝つ
- 10 分のクールダウンと 1 プロセス 3 回の上限。ワークスペース全体の障害で
  チャットを量産しないため
- 巻き直しに失敗したときは元のスレッドへ戻し、元のエラーをそのまま返す。
  つまり今日より悪くはならない
- `/health` の `notionThread` に現在のスレッドと直近の巻き直しが出る。
  heartbeat はその変化を見て Slack へ 1 回だけ通知する

### 止め方

`CHATBOT_HOSTED_WORKER_THREAD_ROTATION=off` を worker の unit に入れて再起動すると、
巻き直しも保存済みレコードの参照も止まり、env / repo 既定値だけで動く。
保存済みレコードを消すだけでもよい。
