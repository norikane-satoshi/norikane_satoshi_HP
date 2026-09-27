import {localizedPageMetadata} from "@/i18n/page-metadata"

export {default} from "@/app/booking/[id]/page"
export const dynamic = "force-dynamic"

export async function generateMetadata({params}: {params: Promise<{id: string}>}) {
  const {id} = await params
  return localizedPageMetadata({
    path: `/booking/${id}`,
    key: "bookingDetails",
  })
}
