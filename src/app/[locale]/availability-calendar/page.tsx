import {localizedPageMetadata} from "@/i18n/page-metadata"

export {default} from "@/app/availability-calendar/page"
export const dynamic = "force-dynamic"

export function generateMetadata() {
  return localizedPageMetadata({
    path: "/availability-calendar",
    key: "availability",
  })
}
