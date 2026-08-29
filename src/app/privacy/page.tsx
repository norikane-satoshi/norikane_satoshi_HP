import type { Metadata } from "next"
import {getLocale} from "next-intl/server"
import { PrivacyPolicyContent } from "@/components/hp/legal-content"
import {localeAlternates} from "@/i18n/metadata"
import type {AppLocale} from "@/i18n/routing"

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale() as AppLocale
  const english = locale === "en"
  return {
    title: english ? "Privacy Policy | Norikane Film Design Office" : "プライバシーポリシー | のりかね映像設計室",
    description: english ? "Privacy policy for Norikane Film Design Office." : "のりかね映像設計室のプライバシーポリシーです。",
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
