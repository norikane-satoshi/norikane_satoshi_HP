# Notion AI の会話分離とスレッド巻き直し

Tier1 の hosted worker は、常時開いた 1 枚の Notion AI ページを使うが、推論先の
スレッドは **HP の会話ごとに分離する**。`CHATBOT_HOSTED_WORKER_NOTION_THREAD_URL`
（VPS）と `src/lib/chatbot/hosted-worker/notion-ai-config.ts` の既定値は Chrome の
起動・health 用の bootstrap thread であり、顧客推論を共有する正本ではない。

`ChatbotLlmRequest.conversationId` は API から worker まで渡され、worker はその SHA-256
hash と Notion が発行した thread URL だけを
`~/.local/state/norikane_satoshi_hp/hosted-worker-conversation-threads.json` に保存する。
顧客文面と生の conversation id はこのファイルへ保存しない。
Chrome の target 判定は bootstrap の固定 ID ではなく、`app.notion.com/chat` かつ
Notion 発行形式の 32 桁 `t` を持つページを許可する。別 origin、任意ページ、任意文字列の
`t` は拒否する。これにより heartbeat は正常な会話切替を target mismatch と誤認しない。

## なぜ巻き直しが要るか

Notion は `runInferenceTranscript` のやり取りをスレッドへ永続化する。
`saveAllThreadOperations: false` を送っても永続化は止まらない（2026-08-07 実測）。
つまりスレッドは必ず育ち、いつか Notion の容量上限に達する。

上限に達すると Notion は推論の代わりに `Column size exceeded` を
アシスタントの本文として返す。`22bfa37` 以降これは生成失敗として扱われ、
顧客には見えず下位 Tier へ落ちるが、**Tier1 は復旧しないので巻き直しが必要**。

以前は同じ理由で 1 スレッドへ全顧客の会話が混在し、ある相談への応答に別の相談の
内容が混ざった（CB-ERR-016）。現在は新しい conversation id を受け取るたびに UI で
新規スレッドを発行し、同じ conversation id の次ターンだけがそのスレッドを再利用する。
conversation id が欠落・不正なら共有スレッドへ戻さず、Tier1 を fail closed する。

## 育つ速さ

各会話のスレッドは、その会話のターンだけで育つ。heartbeat の generate smoke は
固定 scope `hosted-tier1-heartbeat` を使うので顧客相談とは混ざらない。

| 発生源 | 既定の頻度 | 1 日あたりのターン |
|---|---|---|
| heartbeat の generate smoke | 既定 30 分 | 約 48 |
| 顧客の相談 | 実績で 1 日数件 | 数件 |

旧共有スレッドでは 2026-08-07 の実測で 24 時間に heartbeat 由来が 85 回あった。
smoke の間隔を延ばすと heartbeat 専用スレッドの寿命はそのぶん延びるが、
generate 固有の障害の検知が遅れる。間隔を変えるときはこのトレードオフを明示する。

## 巻き直し手順

前提: Tier1 が `Column size exceeded` を返す、または混入が観測された。

1. **新しいスレッドを作る。** worker の Chrome（CDP `127.0.0.1:9223`）で次を順に行う。
   Enter だけでは送信されない。
   - `location.assign("https://app.notion.com/ai")` で空のチャットへ移動する。
     新規チャットのコントロールはクリックしない。テキストノードを持たず、
     アクセシブル名はロケール間で安定しない（2026-08-08 の実ページでは、
     送信ボタンが `AIメッセージを送信` なのに対しこちらは `New chat` だった）。
     半端に巻き直されて `?t=` を失ったタブにはそもそもこのコントロールが無い。
   - `[contenteditable='true'][role='textbox']` が現れるまで待つ（実測 2.5 秒）
   - そこへ CDP `Input.insertText` で 1 文字以上入力する。
     `Runtime.evaluate` で `textContent` を書いても Notion のエディタには届かない。
   - `aria-label` が `/送信|send|submit/i` に一致するボタンをクリックする。
     このボタンは composer に文字が入るまで描画されない。
     2026-08-08 の同じ Chrome でも `AIメッセージを送信` から
     `Submit AI message` へ変化したため、英語動詞も 1 種類に固定しない。
   - URL が `app.notion.com/chat?t=<新ID>` になるので `t` を控える
   - 種メッセージへの返信が流れている間、送信ボタンは消える。再出現するまで
     （実測 8.9 秒）推論を投げない。流れている最中の推論は 0 バイトで返る。

   クライアントで採番した UUID は推論 API に拒否されるので、必ずこの手順で
   Notion 側に発行させる（`48bae9c` で試して Tier1 が落ちた）。

2. **該当 conversation の mapping を差し替える。** 通常は worker が自動で行う。
   bootstrap thread の設定差し替えは、Chrome の起動先自体が使えない場合だけ行う。
   - VPS: `~/.config/norikane-hosted-worker/worker.env` の
     `CHATBOT_HOSTED_WORKER_NOTION_THREAD_URL=https://www.notion.so/chat?t=<新ID>`
     （変更前に必ずバックアップを取る）
   - repo: `notion-ai-config.ts` の `defaultNotionAiChatbotThreadUrl` と
     `notionAiChatbotThreadId`

3. **worker を再起動して確かめる。**
   `systemctl --user restart hosted-notion-ai-worker.service` のあと、
   `/health` が `targetUrlMatches: true`、conversation id 付きの `/generate` が `rawText`
   を返すこと。
   巻き直し直後は履歴が無いぶん応答が速い（実測 28〜60 秒 → 8〜26 秒）。

4. **混入していないことを確かめる。**
   無関係な初回相談を連続で 2 件送り、後の応答に前の会話の案件情報
   （尺・追加作業・媒体など）が出ないことを確認する。

## 自動巻き直し（実装済み）

worker は `Column size exceeded` を検知すると、上の手順を自分で実行し、**その HP
conversation の mapping だけ**を新しいスレッドへ更新してリクエストを 1 回だけ再試行
する。手で巻き直す必要があるのは自動巻き直しが失敗したときだけ。

- 発火は容量エラーだけ。`Internal server error` や `Something went wrong` では
  巻き直さない（Notion 側の一時障害で、チャットを増やしても直らないため）
- 新しいスレッドは conversation mapping へ保存され、worker 再起動後も同じ HP 会話
  だけがそこを使う。保存は再試行より先に行う
- 10 分のクールダウンと 1 プロセス 3 回の上限。ワークスペース全体の障害で
  チャットを量産しないため
- 巻き直しに失敗したときは元のスレッドへ戻し、元のエラーをそのまま返す。
  つまり今日より悪くはならない
- `/health` の `notionThread.rotation` には容量超過による直近の巻き直しだけが出る。
  通常の新規会話発行では通知せず、容量巻き直しだけを heartbeat が Slack へ 1 回通知する

### 止め方

`CHATBOT_HOSTED_WORKER_THREAD_ROTATION=off` は容量超過時の自動巻き直しだけを止める。
会話ごとの新規発行・mapping 再利用・conversation id 必須の fail-closed はセキュリティ
境界なので止まらない。
