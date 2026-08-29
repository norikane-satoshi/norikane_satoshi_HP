import {localizedPageMetadata} from "@/i18n/page-metadata"

export {default} from "@/app/booking/settings/page"

export function generateMetadata() {
  return localizedPageMetadata({
    path: "/booking/settings",
    ja: {title: "予約設定 | のりかね映像設計室", description: "予約サービスの設定を管理します。"},
    en: {title: "Booking settings | Norikane Film Design Office", description: "Manage booking-service settings."},
  })
}
