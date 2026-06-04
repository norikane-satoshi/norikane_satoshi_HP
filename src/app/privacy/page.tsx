import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "プライバシーポリシー | のりかね映像設計室",
  description: "のりかね映像設計室のプライバシーポリシーです。",
}

export default function PrivacyPolicyPage() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 md:px-10">
      <article className="glass-card p-8 md:p-10 xl:p-12">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-hp-muted">Privacy Policy</p>
        <h1 className="mt-2 text-3xl font-bold text-hp md:text-4xl">プライバシーポリシー</h1>
        <p className="mt-4 text-sm leading-7 text-hp-muted">
          のりかね映像設計室は、norikane.studio および AI 相談窓口、予約導線で取り扱う情報を、
          案件対応と安全な運用に必要な範囲で取得し、利用目的を明確にしたうえで管理します。
        </p>

        <div className="mt-10 space-y-8 text-sm leading-7 text-hp">
          <section>
            <h2 className="text-lg font-semibold text-hp">取得する情報</h2>
            <p className="mt-3 text-hp-muted">
              チャット入力、予約情報、ログイン情報、メールアドレス、会社名・氏名、参考 URL、
              Cookie・セッション識別子、アクセスログ、送信日時、問い合わせ内容、予約変更やキャンセルに関する情報を取得する場合があります。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">利用目的</h2>
            <p className="mt-3 text-hp-muted">
              取得した情報は、問い合わせ対応、案件整理、予約管理、ログイン本人の文脈復元、
              サービス改善、不正利用の検知、セキュリティ対策、法令上必要な記録管理のために利用します。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">AI の利用</h2>
            <p className="mt-3 text-hp-muted">
              AI 相談窓口では、案件整理と連絡補助のために AI を利用する場合があります。
              AI 応答は相談補助であり、正式見積、契約成立、
              納期保証、または最終判断ではありません。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">本人文脈とカレンダー参照</h2>
            <p className="mt-3 text-hp-muted">
              ログインしている本人の過去の相談、予約、参考 URL のみを文脈として利用し、
              他ユーザー情報を相談応答に使いません。カレンダーは空き状況の確認に必要な範囲で、
              予約が埋まっている時間帯のみを参照し、予定タイトル、参加者、場所は取得しません。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">保管期間</h2>
            <p className="mt-3 text-hp-muted">
              チャットログは 1 週間で自動削除します。予約、問い合わせ、
              請求・契約・法令上必要な情報は、業務上必要な期間保管します。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">第三者提供と外部サービス</h2>
            <p className="mt-3 text-hp-muted">
              法令に基づく場合を除き、本人の同意なく第三者へ提供しません。メール送信、カレンダー連携、
              認証、ホスティング、データ保管のため、外部の業務委託先やクラウドサービスを利用する場合があります。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">開示・訂正・削除等</h2>
            <p className="mt-3 text-hp-muted">
              保有する個人データについて、本人から開示、訂正、利用停止、削除等の相談があった場合は、
              本人確認のうえ、法令に従って対応します。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">問い合わせ窓口</h2>
            <p className="mt-3 text-hp-muted">
              本ポリシーに関する問い合わせは、norikane.satoshi@gmail.com までご連絡ください。
            </p>
          </section>
        </div>

        <p className="mt-10 text-xs text-hp-muted">改定日：2026年5月26日</p>
      </article>
    </section>
  )
}
