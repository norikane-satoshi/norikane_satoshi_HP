import type {Metadata} from "next"
import {getLocale} from "next-intl/server"
import {localeAlternates} from "./metadata"
import type {AppLocale} from "./routing"

export async function localizedPageMetadata(input: {
  path: string
  ja: {title: string; description: string}
  en: {title: string; description: string}
}): Promise<Metadata> {
  const locale = await getLocale() as AppLocale
  const copy = input[locale]
  return {
    ...copy,
    alternates: localeAlternates(input.path, locale),
    openGraph: {
      ...copy,
      locale: locale === "ja" ? "ja_JP" : "en_US",
    },
  }
}
