import {localizedPageMetadata} from "@/i18n/page-metadata"

export {default} from "@/app/booking/[id]/page"
export const dynamic = "force-dynamic"

export async function generateMetadata({params}: {params: Promise<{id: string}>}) {
  const {id} = await params
  return localizedPageMetadata({
    path: `/booking/${id}`,
    ja: {title: "予約内容 | のりかね映像設計室", description: "予約内容の確認・変更を行います。"},
    en: {title: "Booking details | Norikane Film Design Office", description: "Review or change a booking."},
  })
}
