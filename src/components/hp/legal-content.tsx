import type { ReactNode } from "react"

type LegalHeadingLevel = "h1" | "h2"

type LegalContentProps = {
  headingLevel?: LegalHeadingLevel
  locale?: "ja" | "en"
}

function LegalHeading({
  as: Tag,
  children,
}: {
  as: LegalHeadingLevel
  children: ReactNode
}) {
  return <Tag className="mt-2 text-3xl font-bold text-hp md:text-4xl">{children}</Tag>
}

export function PrivacyPolicyContent({ headingLevel = "h1", locale = "ja" }: LegalContentProps) {
  if (locale === "en") return <EnglishPrivacyPolicyContent headingLevel={headingLevel} />
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-hp-muted">Privacy Policy</p>
      <LegalHeading as={headingLevel}>プライバシーポリシー</LegalHeading>
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
            取得した情報は、問い合わせ対応、案件整理、予約管理、ログインしている方の相談内容の復元、
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
          <h2 className="text-lg font-semibold text-hp">ご相談内容とカレンダー参照</h2>
          <p className="mt-3 text-hp-muted">
            ログインしている方の過去の相談、予約、参考 URL のみを相談整理に必要な範囲で利用し、
            他ユーザー情報を相談応答に使いません。カレンダーは空き状況の確認に必要な範囲で、
            予定の有無のみを参照し、予定タイトル、参加者、場所は取得しません。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-hp">保管期間</h2>
          <p className="mt-3 text-hp-muted">
            チャットログは、最後のメッセージから 7 日を過ぎると自動削除します。予約、問い合わせ、
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

      <p className="mt-10 text-xs text-hp-muted">改定日：2026年8月29日</p>
    </>
  )
}

export function TermsContent({ headingLevel = "h1", locale = "ja" }: LegalContentProps) {
  if (locale === "en") return <EnglishTermsContent headingLevel={headingLevel} />
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-hp-muted">Terms of Use</p>
      <LegalHeading as={headingLevel}>利用規約</LegalHeading>
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
            正式見積、契約成立、納期保証、業務受託の確約ではありません。正式な条件は則兼本人の確認後に確定します。
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
            法令上制限できない責任を免除するものではありません。最終判断は則兼本人の確認に基づきます。
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
    </>
  )
}

function EnglishPrivacyPolicyContent({headingLevel}: {headingLevel: LegalHeadingLevel}) {
  const sections = [
    ["Information we collect", "We may collect chat messages, booking details, sign-in information, email addresses, company and personal names, reference URLs, cookies and session identifiers, access logs, timestamps, inquiry details, and information about booking changes or cancellations."],
    ["Purposes of use", "We use this information to respond to inquiries, organize projects, manage bookings, restore consultation history for signed-in users, improve the service, detect misuse, maintain security, and retain records required by law."],
    ["Use of AI", "The AI consultation desk may use AI to help organize project information and communications. AI responses are advisory and do not constitute a formal quotation, contract, delivery guarantee, or final decision."],
    ["Consultation history and calendar access", "We use only the signed-in user's previous consultations, bookings, and reference URLs where needed to organize their inquiry. We do not use another user's information in responses. Calendar access is limited to availability; event titles, attendees, and locations are not collected."],
    ["Retention", "Chat logs are deleted automatically seven days after the last message. Booking, inquiry, billing, contract, and legally required records are retained only for the period needed for business or legal purposes."],
    ["Third parties and external services", "Except where required by law, we do not provide personal information to third parties without consent. We may use contractors and cloud services for email delivery, calendar integration, authentication, hosting, and data storage."],
    ["Access, correction, and deletion", "When a person requests access to, correction of, suspension of use of, or deletion of personal data we hold, we verify their identity and respond in accordance with applicable law."],
    ["Contact", "Questions about this policy may be sent to norikane.satoshi@gmail.com."],
  ] as const

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-hp-muted">Privacy Policy</p>
      <LegalHeading as={headingLevel}>Privacy Policy</LegalHeading>
      <p className="mt-4 text-sm leading-7 text-hp-muted">
        Norikane Film Design Office collects and manages information handled through norikane.studio,
        its AI consultation desk, and booking flows only for clearly stated purposes necessary to serve projects safely.
      </p>
      <div className="mt-10 space-y-8 text-sm leading-7 text-hp">
        {sections.map(([title, body]) => (
          <section key={title}>
            <h2 className="text-lg font-semibold text-hp">{title}</h2>
            <p className="mt-3 text-hp-muted">{body}</p>
          </section>
        ))}
      </div>
      <p className="mt-10 text-xs text-hp-muted">Last revised: August 29, 2026</p>
    </>
  )
}

function EnglishTermsContent({headingLevel}: {headingLevel: LegalHeadingLevel}) {
  const sections = [
    ["Covered services", "These terms apply to norikane.studio, the AI consultation desk, booking forms, booking-change and cancellation flows, and related email communications operated by Norikane Film Design Office."],
    ["Role of the AI consultation desk", "The AI consultation desk helps organize inquiries and bookings. Chat responses and proposed slots are not formal quotations, contracts, delivery guarantees, or commitments to accept work. Conditions become final only after confirmation by Satoshi Norikane."],
    ["Prohibited conduct", "You must not submit false information, infringe third-party rights, disclose unnecessary confidential information, attack or gain unauthorized access to systems, send spam, or interfere with the service or other users."],
    ["Bookings", "Bookings, changes, and cancellations require separate confirmation. Calendar and AI suggestions indicate possible availability and are not guarantees."],
    ["Intellectual property and submitted materials", "Text, images, UI, and other site content belong to us or their legitimate owners. You represent that you hold the rights or permissions needed for materials, reference URLs, and project information you submit. Submitted materials are handled only to respond, review, quote, and manage bookings."],
    ["Confidentiality", "Submitted information is handled for project-related purposes. Do not include confidential, personal, or third-party information beyond what is necessary to organize your inquiry."],
    ["Disclaimer", "We do not guarantee the accuracy, completeness, or availability of AI responses, suggestions, or availability displays. External-service outages, communications, authentication, or calendar issues may make the service unavailable. Nothing here excludes liability for intentional misconduct, gross negligence, or liability that cannot legally be limited. Final decisions are confirmed by Satoshi Norikane."],
    ["Confirmation of contract terms", "Terms such as fees, schedules, cancellation, rights clearance, and confidentiality are governed by the applicable quotation, purchase order, contract, or confirmed email. Chat alone does not determine legal validity or contract terms."],
    ["Governing law and consultation", "These terms are governed by Japanese law. If a question or dispute arises, the parties will discuss it in good faith and seek a resolution."],
    ["Contact", "Questions about these terms may be sent to norikane.satoshi@gmail.com."],
  ] as const

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-hp-muted">Terms of Use</p>
      <LegalHeading as={headingLevel}>Terms of Use</LegalHeading>
      <p className="mt-4 text-sm leading-7 text-hp-muted">
        These terms govern use of norikane.studio and its AI consultation and booking services.
      </p>
      <div className="mt-10 space-y-8 text-sm leading-7 text-hp">
        {sections.map(([title, body]) => (
          <section key={title}>
            <h2 className="text-lg font-semibold text-hp">{title}</h2>
            <p className="mt-3 text-hp-muted">{body}</p>
          </section>
        ))}
      </div>
      <p className="mt-10 text-xs text-hp-muted">Last revised: May 26, 2026</p>
    </>
  )
}
