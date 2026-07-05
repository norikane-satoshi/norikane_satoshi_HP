import type { Metadata } from "next"
import { PrivacyPolicyContent } from "@/components/hp/legal-content"

export const metadata: Metadata = {
  title: "プライバシーポリシー | のりかね映像設計室",
  description: "のりかね映像設計室のプライバシーポリシーです。",
}

export default function PrivacyPolicyPage() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 md:px-10">
      <article className="glass-card p-8 md:p-10 xl:p-12">
        <PrivacyPolicyContent />
      </article>
    </section>
  )
}
