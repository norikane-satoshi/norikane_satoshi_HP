import {localizedPageMetadata} from "@/i18n/page-metadata"

export {default} from "@/app/signup/page"

export function generateMetadata() {
  return localizedPageMetadata({
    path: "/signup",
    key: "signup",
  })
}
