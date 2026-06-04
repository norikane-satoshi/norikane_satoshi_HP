import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "利用規約 | のりかね映像設計室",
  description: "のりかね映像設計室の利用規約です。",
}

export default function TermsPage() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 md:px-10">
      <article className="glass-card p-8 md:p-10 xl:p-12">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-hp-muted">Terms of Use</p>
        <h1 className="mt-2 text-3xl font-bold text-hp md:text-4xl">利用規約</h1>
        <p className="mt-4 text-sm leading-7 text-hp-muted">
          本規約は、norikane.studio と、同サイト上の AI 相談窓口および予約導線の利用条件を定めるものです。
        </p>

        <div className="mt-10 space-y-8 text-sm leading-7 text-hp">
          <section>
            <h2 className="text-lg font-semibold text-hp">対象サービス</h2>
            <p className="mt-3 text-hp-muted">
              本規約は、のりかね映像設計室が運営する norikane.studio、AI 相談窓口、予約フォーム、
              予約変更・キャンセル導線、関連するメール連絡に適用されます。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">AI 相談窓口の位置づけ</h2>
            <p className="mt-3 text-hp-muted">
              AI 相談窓口は、案件整理と予約補助を目的とした相談補助機能です。チャット内の回答や候補提示は、
              正式見積、契約成立、納期保証、業務受託の確約ではありません。正式な条件はのりかね本人の確認後に確定します。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">禁止事項</h2>
            <p className="mt-3 text-hp-muted">
              虚偽情報の入力、第三者の権利侵害、必要範囲を超える秘密情報の投入、攻撃・不正アクセス、
              スパム送信、システムや他の利用者に支障を与える行為を禁止します。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">予約</h2>
            <p className="mt-3 text-hp-muted">
              予約成立、変更、キャンセルは、別途確認が必要です。カレンダー上の候補や AI が提示する時間帯は、
              空き状況の目安であり、確定保証ではありません。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">知的財産と送信資料</h2>
            <p className="mt-3 text-hp-muted">
              サイト上の文章、画像、UI、その他コンテンツの権利は、当方または正当な権利者に帰属します。
              利用者は、チャットで送る資料、参考 URL、案件情報について、必要な権利または利用許諾を有することを表明します。
              送信資料は案件対応、確認、見積検討、予約管理のために取り扱います。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">秘密保持</h2>
            <p className="mt-3 text-hp-muted">
              送信内容は案件対応目的で取り扱います。ただし、チャット入力には、案件整理に不要な機密情報、
              個人情報、第三者の秘密情報を過度に含めないでください。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">免責</h2>
            <p className="mt-3 text-hp-muted">
              AI 応答、候補提示、空き状況表示の正確性、完全性、可用性を保証しません。外部サービス障害、
              通信環境、認証・カレンダー連携の不具合により利用できない場合があります。事業者の故意または重過失による責任、
              法令上制限できない責任を免除するものではありません。最終判断はのりかね本人の確認に基づきます。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">契約条件の確認</h2>
            <p className="mt-3 text-hp-muted">
              料金、納期、キャンセル、権利処理、秘密保持などの条件は、個別の見積書、発注書、契約書、
              またはメール等で確認した内容を優先します。チャットだけで法的な有効性や契約条件を断定しません。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">準拠法と協議</h2>
            <p className="mt-3 text-hp-muted">
              本規約は日本法に準拠します。本サービスに関して疑義または紛争が生じた場合は、
              当事者間で誠実に協議し、解決を図ります。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-hp">問い合わせ窓口</h2>
            <p className="mt-3 text-hp-muted">
              本規約に関する問い合わせは、norikane.satoshi@gmail.com までご連絡ください。
            </p>
          </section>
        </div>

        <p className="mt-10 text-xs text-hp-muted">改定日：2026年5月26日</p>
      </article>
    </section>
  )
}
