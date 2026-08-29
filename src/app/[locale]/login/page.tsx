import {localizedPageMetadata} from "@/i18n/page-metadata"

export {default} from "@/app/login/page"

export function generateMetadata() {
  return localizedPageMetadata({
    path: "/login",
    key: "login",
  })
}
