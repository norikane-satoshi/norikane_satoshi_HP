import {localizedPageMetadata} from "@/i18n/page-metadata"

export {default} from "@/app/booking/settings/page"

export function generateMetadata() {
  return localizedPageMetadata({
    path: "/booking/settings",
    key: "bookingSettings",
  })
}
