import type {Metadata} from "next"
import type {AppLocale} from "./routing"

export const SITE_URL = "https://norikane.studio"

export function localeAlternates(pathname: string, locale: AppLocale): Metadata["alternates"] {
  const normalized = pathname === "/" ? "" : pathname
  return {
    canonical: `${SITE_URL}/${locale}${normalized}`,
    languages: {
      ja: `${SITE_URL}/ja${normalized}`,
      en: `${SITE_URL}/en${normalized}`,
      "x-default": `${SITE_URL}/ja${normalized}`,
    },
  }
}

