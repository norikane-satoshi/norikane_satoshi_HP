import type {Metadata} from "next"
import {getLocale} from "next-intl/server"
import {localeAlternates} from "./metadata"
import type {AppLocale} from "./routing"
import {getLocalizedCopy, type AppMessages} from "./copy"

export async function localizedPageMetadata(input: {
  path: string
  key: keyof AppMessages["PageMetadata"]
}): Promise<Metadata> {
  const locale = await getLocale() as AppLocale
  const copy = getLocalizedCopy(locale, "PageMetadata")[input.key]
  return {
    ...copy,
    alternates: localeAlternates(input.path, locale),
    openGraph: {
      ...copy,
      locale: locale === "ja" ? "ja_JP" : "en_US",
    },
  }
}
