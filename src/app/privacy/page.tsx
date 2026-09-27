import type { Metadata } from "next"
import {getLocale} from "next-intl/server"
import { PrivacyPolicyContent } from "@/components/hp/legal-content"
import {localeAlternates} from "@/i18n/metadata"
import type {AppLocale} from "@/i18n/routing"
import {getLocalizedCopy} from "@/i18n/copy"

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale() as AppLocale
  const copy = getLocalizedCopy(locale, "PageMetadata").privacy
  return {
    ...copy,
    alternates: localeAlternates("/privacy", locale),
  }
}

export default async function PrivacyPolicyPage() {
  const locale = await getLocale() as AppLocale
  return (
    <section className="mx-auto w-full max-w-4xl px-6 md:px-10">
      <article className="glass-card p-8 md:p-10 xl:p-12">
        <PrivacyPolicyContent locale={locale} />
      </article>
    </section>
  )
}
