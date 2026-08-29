import {localizedPageMetadata} from "@/i18n/page-metadata"

export {default} from "@/app/line/booking/page"
export const dynamic = "force-dynamic"

export function generateMetadata() {
  return localizedPageMetadata({
    path: "/line/booking",
    ja: {title: "LINE予約 | のりかね映像設計室", description: "LINEから予約候補日を選択できます。"},
    en: {title: "LINE booking | Norikane Film Design Office", description: "Choose booking dates through LINE."},
  })
}
