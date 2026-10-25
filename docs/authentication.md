# メール確認とセッション失効

初回のメール確認では、未確認の間に保存されたパスワードを同じ更新で消去する。
判定は `src/lib/auth/server/verify-email.ts` に集約し、Google の確認済みメール、
Auth.js のマジックリンク用 adapter、確認リンクから呼ぶ。確認済みのユーザーには
この消去を適用しない。登録の更新も未確認の行だけに限定し、確認後の再保存を防ぐ。

確認後にパスワードを使う場合は、既存のパスワード再設定で本人が設定する。
再設定は新しいパスワードの保存と tokenVersion の増加を同時に行う。

セッション更新と認証 callback は、キャッシュを使わず DB の tokenVersion と JWT の
版を比較する。更新で古い JWT の版を書き換えない。callback は古いセッションの
Cookie だけを Auth.js に渡す前に除き、OAuth state・PKCE と新規ログインの Cookie を保つ。
通常のセッション参照に使う既存の tokenVersion キャッシュは最大60秒の遅延がある。

既存の確認済みパスワードには設定経緯の記録がないため、正当な再設定によるものかを
現在の User / Account 行だけでは区別できない。一括消去はしない。対応する場合は
対象と影響を所有者が確認し、別途承認した範囲で失効・再設定を行う。

回帰確認は `tests/unit/auth/verify-email-database.test.ts`、
`tests/unit/auth/verified-google-email.test.ts`、`tests/unit/auth/callback-session.test.ts`、
`tests/unit/api/auth/signup.test.ts`、`tests/unit/api/auth/verify-email.test.ts` を使う。
