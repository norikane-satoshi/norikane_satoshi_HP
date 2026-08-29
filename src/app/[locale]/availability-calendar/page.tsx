import {localizedPageMetadata} from "@/i18n/page-metadata"

export {default} from "@/app/availability-calendar/page"
export const dynamic = "force-dynamic"

export function generateMetadata() {
  return localizedPageMetadata({
    path: "/availability-calendar",
    ja: {title: "予約可能日 | のりかね映像設計室", description: "カラーグレーディングの予約可能日を確認できます。"},
    en: {title: "Availability | Norikane Film Design Office", description: "View available dates for color-grading projects."},
  })
}
