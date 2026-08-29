# Notion AI の非表示会話分離とスレッド巻き直し

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

## 正準ライフサイクル

新しい HP `conversationId` の Tier 1 は次の順序を崩さない。

1. Notion UI の空チャットを開き、Notion が発行した thread ID を得る。
2. conversation scope hash と thread URL/version の mapping を保存する。
3. UI の「削除」と等価な `alive=false` transaction を送る。
4. read-after-write で thread record が存在し、`alive=false`、Notion が生成した
   `deleted_time` があり、workspace Chat 一覧から消えていることを確認する。
5. URLへ再移動せず、保存済み thread ID を `runInferenceTranscript` へ直接渡す。
6. 推論後も同じ3条件を再確認してから Tier 1 成功を返す。

非表示確認は最大2回だけ行う。確認できなければ共有threadやbootstrap threadへ戻さず、
Tier 1を fail closedにしてTier 2へフォールバックする。`deleted_time`はアプリ側で書かず、
Notion recordの数値epochまたはISO値を読み、ログ用のISO値へ正規化する。

thread URLの `t=` は32桁だが、Notion APIのthread pointerと推論payloadにはハイフン付き
UUIDを渡す。両形式は比較時だけハイフンを除いて同一視する。

同じHP会話は同じhidden threadを再利用する。別会話は必ず別threadを使う。
stored threadが取得成功のうえで存在しない場合だけ、新しいhidden threadを発行し、HP DBに
残るその会話のmessagesだけを再投入する。一時的なNotion API失敗は「完全削除」とみなさない。

## 保持期間

- Notion側: `deleted_time`を起点に既定約30日。Businessではこの期間を変更しない。
- HP側: `lastMessageAt`を起点に7日。日次cleanupで会話本体を削除する。
- 起算点が違うため、Notion threadが先に消れることは正常系として許容する。
- `deleted_time + 30日`以降にrecord missingを確認した再作成だけを
  `retentionPurgeDetected=true` とする。期限前のmissingとは分けて追跡する。

実際のBusiness環境で30日後に完全削除された事実は、観測日が来るまで未実証として扱う。
即時の非表示、record保持、hidden threadでの推論継続とは別の証拠である。

## 安全な観測情報

worker、Vercel境界ログ、Slack fallback通知、localhost限定debug panelには必要に応じて次だけを出す。

- conversation scope hash、thread ID hash、thread version
- visibility、alive、deleted at、推定保持期限
- Chat一覧からの非表示、hide試行数、hide検証、推論後再検証
- record missing、retention purge、再作成、HP DB文脈再構築
- 使用Tierとfallback reason、build SHA

thread URL、生conversation ID、Cookie、token、認証header、system prompt、会話本文、
Notion AIの内部推論は表示・保存しない。

## なぜ巻き直しが要るか

Notion は `runInferenceTranscript` のやり取りをスレッドへ永続化する。
`saveAllThreadOperations: false` を送っても永続化は止まらない（2026-08-07 実測）。
つまりスレッドは必ず育ち、いつか Notion の容量上限に達する。

上限に達すると Notion は推論の代わりに `Column size exceeded` を
アシスタントの本文として返す。`22bfa37` 以降これは生成失敗として扱われ、
顧客には見えず下位 Tier へ落ちるが、**Tier1 は復旧しないので巻き直しが必要**。

以前は同じ理由で 1 スレッドへ全顧客の会話が混在し、ある相談への応答に別の相談の
内容が混ざった（CB-ERR-016）。現在は新しい conversation id を受け取るたびに UI で
新規スレッドを発行して直ちに非表示にし、同じ conversation id の次ターンだけが
保存済みIDを直接再利用する。
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
   bootstrap threadはChrome起動とhealth専用なので、会話の容量巻き直しでは変更しない。

3. **hidden状態を確かめる。** `alive=false`、`deleted_time`、Chat一覧不在を確認し、
   同じIDへの直接推論後にも同じ状態であることを再確認する。

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

## 実環境検証（2026-08-08）

VPS Hosted Chromeの使い捨て会話だけで次を確認した。既存の実ユーザーthreadと、
読み取り証拠に指定された参考threadは変更していない。

- 新規threadを発行後、`alive=false`、Notion生成`deleted_time`、Chat一覧不在を確認
- hidden threadへの1回目と2回目のTier 1推論が成功
- 新しいclient instanceから同じthread hashを再利用
- 別conversationは異なるthread hash
- 各会話のCanaryへ回答し、相手会話のCanaryは非混入
- 推論後にもhidden状態を再確認

検証コマンドは `pnpm chatbot:verify-hidden-thread-live`。出力はTier、mode、hash、booleanだけで、
生ID、URL、Canary値、回答本文、secretを含めない。
