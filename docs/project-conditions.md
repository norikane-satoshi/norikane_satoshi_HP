# 案件条件の共通契約

`src/lib/booking/domain/project-conditions.ts` を質問・選択肢・入力形式・表示条件の正本とする。

- `projectConditionDefinitions`: id / label / question / input / options / visibility。
- `getProjectConditionDefinition(id)`, `isConditionVisible(definition, answers)`。
- `validateConditionAnswers(value: unknown)` は `{ success: true, data: ConditionAnswers } | { success: false, issues: { path: string; message: string }[] }`。未知の質問・選択肢、入力型不一致、不正日付、非整数秒を拒否し、現在の選択で非表示になる回答を data から除く。
- `sanitizeConditionAnswers(value: unknown): ConditionAnswers` は同じ検証を行い、不正入力では TypeError を投げる。JSON の受け口では validate の結果で 400 を返す。
- `formatConditionAnswer(definition, answer)`, `projectConditionDetails(answers)` は既存の label / value 経路へ出力する。
- `booking-details.ts` の `readBookingDetailsMemo(memo)` は `{ details: BookingDetail[], note: string }` を返す。保存済みの定義 label を読み、内部工程メモを除外する共通 read adapter。
- `ConversationState.conditionAnswers: Record<string, ConditionAnswer>` は質問 ID を key にする。質問文は保存キーにしない。
- `ConditionAnswer`: status (`answered` / `unknown`), selectedIds, text, number, date, dates, composition, otherComment, sourceMessageId。未回答は key 不在。未定は status=unknown。
- `WorkCompositionRow = { name?: string; count: number; durationSeconds?: number }`。本数は正の整数、尺は正の整数秒。尺不明は undefined。
- `project-length` ID は維持し、input=composition。`totalWorkCompositionSeconds` / `totalWorkCompositionMinutes` は全行の尺確定時だけ count × seconds を合計する。
- `retouch-cut-count`: input=number。追加作業が retouch / skin-retouch / compositing の時だけ表示する。
- 日付 ID: desired-delivery-date / delivery-date-reason / material-timing / preferred-dates / unavailable-dates。
- `preferred-dates` の unknownValue は「未定（日程は則兼と相談）」。それ以外の未回答は「未確認」。表示・メール・メモは同じ定義値を使う。
- 安定種別 ID: cm / mv / feature / short-film / documentary / drama / vertical / live / corporate-video / event-video / lecture-training / film-look-consultation / other。

旧ログの質問文認識は legacy reader に限定する。新回答は質問 ID を必須にする。conditionAnswers が存在する会話では ID 回答だけを読み、未回答は未確認。legacy reader は conditionAnswers 不在の保存済みログだけに使用する。旧 jobKind の代表尺 ID は読取時に安定 ID へ正規化し、工程プリセットの ID と実作品の尺は分離する。

`JobKind` は canonical + legacy の union。`normalizeJobKind` は保存済み alias を正規化し、`workflowPresetJobKind` は工程推定の代表プリセットへ明示変換する。対応する工程基準のない種別（short-film / documentary / corporate-video など）は undefined を返す。推定側で確認待ちにする。`WorkflowEstimate.referencePresetId` は LegacyJobKind のまま。`JobContext.workComposition` で作品構成を保持できる。

server の `duration-estimator.ts` は `workflowDurationJobKindMap` を `JobKind` で直接 index せず、`workflowPresetJobKind` で正規化してから読む。未対応種別は推定なし・要確認。安定 ID の選択自体には尺確認を要求しない。
