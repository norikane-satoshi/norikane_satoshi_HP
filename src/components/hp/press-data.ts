import {getLocalizedCopy} from "@/i18n/copy"

export type PressLink = {
  label: string
  href: string
}

export type PressItem = {
  period: string
  title: string
  description: string
  links: PressLink[]
}

export type PressCategory = {
  title: string
  items: PressItem[]
}

const PRESS_LINKS = [
  [
    ["https://bmduser.jp/eve_detail.php?id=95"],
    ["https://www.imagica-ems.co.jp/event/cbi_event_hbo-cas_240927/"],
    ["https://videosalon.jp/report/imagicaems_vp_event/"],
    ["https://bmduser.jp/eve_detail.php?id=127"],
  ],
  [
    ["https://videosalon.jp/report/jukkakukannosatsujin/", "https://www.imagica-ems.co.jp/case-study/jukkakukannosatsujin_20240515/"],
    ["https://gxcblog.exblog.jp/36845321/"],
    ["https://www.imagica-ems.co.jp/case-study/barasamu2_231005/"],
    ["https://www.nhk.jp/g/ts/54KJPL1QGM/blog/bl/p987Er5pz4/bp/pz9aJoZRyz/"],
  ],
  [
    ["https://www.imagica-ems.co.jp/case-study/next-generation-workflow-230810/"],
  ],
] as const

export function getPressCategories(locale: "ja" | "en"): PressCategory[] {
  return getLocalizedCopy(locale, "PressContent").categories.map((category, categoryIndex) => ({
    title: category.title,
    items: category.items.map((item, itemIndex) => ({
      period: item.period,
      title: item.title,
      description: item.description,
      links: item.linkLabels.map((label, linkIndex) => ({
        label,
        href: PRESS_LINKS[categoryIndex]?.[itemIndex]?.[linkIndex] ?? "#",
      })),
    })),
  }))
}

export const PRESS_CATEGORIES = getPressCategories("ja")
