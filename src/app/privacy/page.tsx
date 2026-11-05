import type { Metadata } from "next"
import { PrivacyPolicyContent } from "@/components/hp/legal-content"

export const metadata: Metadata = {
  title: "プライバシーポリシー | のりかね映像設計室",
  description: "のりかね映像設計室のプライバシーポリシーです。",
}

export default function PrivacyPolicyPage() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-12 md:px-10 md:py-16">
      <article>
        <PrivacyPolicyContent />
      </article>
    </section>
  )
}
