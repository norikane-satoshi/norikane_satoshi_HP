import {localizedPageMetadata} from "@/i18n/page-metadata"

export {default} from "@/app/login/page"

export function generateMetadata() {
  return localizedPageMetadata({
    path: "/login",
    ja: {title: "ログイン | のりかね映像設計室", description: "予約と相談履歴へログインします。"},
    en: {title: "Sign in | Norikane Film Design Office", description: "Sign in to booking and consultation history."},
  })
}
