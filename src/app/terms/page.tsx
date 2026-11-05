import type { Metadata } from "next"
import { TermsContent } from "@/components/hp/legal-content"

export const metadata: Metadata = {
  title: "利用規約 | のりかね映像設計室",
  description: "のりかね映像設計室の利用規約です。",
}

export default function TermsPage() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-12 md:px-10 md:py-16">
      <article>
        <TermsContent />
      </article>
    </section>
  )
}
