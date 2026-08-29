import {localizedPageMetadata} from "@/i18n/page-metadata"

export {default} from "@/app/booking/history/page"
export const dynamic = "force-dynamic"

export function generateMetadata() {
  return localizedPageMetadata({
    path: "/booking/history",
    ja: {title: "予約履歴 | のりかね映像設計室", description: "予約履歴を確認できます。"},
    en: {title: "Booking history | Norikane Film Design Office", description: "Review your booking history."},
  })
}
