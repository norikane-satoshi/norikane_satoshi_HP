import type { Metadata } from "next"
import {getLocale} from "next-intl/server"
import { TermsContent } from "@/components/hp/legal-content"
import {localeAlternates} from "@/i18n/metadata"
import type {AppLocale} from "@/i18n/routing"
import {getLocalizedCopy} from "@/i18n/copy"

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale() as AppLocale
  const copy = getLocalizedCopy(locale, "PageMetadata").terms
  return {
    ...copy,
    alternates: localeAlternates("/terms", locale),
  }
}

export default async function TermsPage() {
  const locale = await getLocale() as AppLocale
  return (
    <section className="mx-auto w-full max-w-4xl px-6 md:px-10">
      <article className="glass-card p-8 md:p-10 xl:p-12">
        <TermsContent locale={locale} />
      </article>
    </section>
  )
}
