import type { Metadata } from "next"
import { TermsContent } from "@/components/hp/legal-content"

export const metadata: Metadata = {
  title: "利用規約 | のりかね映像設計室",
  description: "のりかね映像設計室の利用規約です。",
}

export default function TermsPage() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 md:px-10">
      <article className="glass-card p-8 md:p-10 xl:p-12">
        <TermsContent />
      </article>
    </section>
  )
}
