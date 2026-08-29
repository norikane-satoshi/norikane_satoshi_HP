import {localizedPageMetadata} from "@/i18n/page-metadata"

export {default} from "@/app/booking/page"
export const dynamic = "force-dynamic"

export function generateMetadata() {
  return localizedPageMetadata({
    path: "/booking",
    ja: {title: "予約 | のりかね映像設計室", description: "カラーグレーディングの予約リクエストを送信できます。"},
    en: {title: "Booking | Norikane Film Design Office", description: "Send a color-grading booking request."},
  })
}
