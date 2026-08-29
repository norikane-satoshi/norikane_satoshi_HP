import {localizedPageMetadata} from "@/i18n/page-metadata"

export {default} from "@/app/signup/page"

export function generateMetadata() {
  return localizedPageMetadata({
    path: "/signup",
    ja: {title: "アカウント作成 | のりかね映像設計室", description: "予約と相談のためのアカウントを作成します。"},
    en: {title: "Create account | Norikane Film Design Office", description: "Create an account for bookings and consultations."},
  })
}
