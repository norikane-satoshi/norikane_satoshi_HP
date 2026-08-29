import {localizedPageMetadata} from "@/i18n/page-metadata"

export {default} from "@/app/booking/page"
export const dynamic = "force-dynamic"

export function generateMetadata() {
  return localizedPageMetadata({
    path: "/booking",
    key: "booking",
  })
}
