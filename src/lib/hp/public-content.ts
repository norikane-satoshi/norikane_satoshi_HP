import type {AppLocale} from "@/i18n/routing"
import {getLocalizedCopy} from "@/i18n/copy"

const tools = ["DaVinci Resolve", "Premiere Pro", "After Effects", "Photoshop"] as const
const socialLinks = [
  {label: "X", href: "https://x.com/norikanesatoshi"},
  {label: "YouTube", href: "https://www.youtube.com/@norikanesatoshi"},
  {label: "Instagram", href: "https://www.instagram.com/satoshi_norikane_colorist/"},
] as const

export function getHpPublicContent(locale: AppLocale) {
  const content = getLocalizedCopy(locale, "PublicContent")
  return {
    ...content,
    profile: {...content.profile, tools, socialLinks},
  }
}

export const hpPublicContent = getHpPublicContent("ja")
export type HpPublicContent = ReturnType<typeof getHpPublicContent>
