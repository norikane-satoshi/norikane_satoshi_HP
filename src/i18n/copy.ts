import en from "../../messages/en.json"
import ja from "../../messages/ja.json"
import type {AppLocale} from "./routing"

export type AppMessages = typeof ja

const messages: Record<AppLocale, AppMessages> = {ja, en}

export function getLocalizedCopy<Namespace extends keyof AppMessages>(
  locale: string,
  namespace: Namespace,
): AppMessages[Namespace] {
  return messages[locale === "en" ? "en" : "ja"][namespace]
}
