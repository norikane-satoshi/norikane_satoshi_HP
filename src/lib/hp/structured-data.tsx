import { hpPublicContent } from "@/lib/hp/public-content"
import {
  SITE_BRAND_NAME,
  SITE_BRAND_NAME_EN,
  SITE_COMPANY_LOCALITY,
  SITE_COMPANY_NAME,
  SITE_COMPANY_REGION,
  SITE_CONTACT_EMAIL,
  SITE_OWNER_NAME,
  SITE_OWNER_NAME_EN,
  SITE_URL,
} from "@/lib/site-brand"

const ORGANIZATION_ID = `${SITE_URL}/#organization`
const PERSON_ID = `${SITE_URL}/#person`

/** 検索エンジン向けに、事業者と本人を日本語名・英語名の両方で伝える。 */
export function buildSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORGANIZATION_ID,
        name: SITE_BRAND_NAME,
        alternateName: SITE_BRAND_NAME_EN,
        legalName: SITE_COMPANY_NAME,
        url: SITE_URL,
        email: SITE_CONTACT_EMAIL,
        description: hpPublicContent.intro,
        address: {
          "@type": "PostalAddress",
          addressCountry: "JP",
          addressRegion: SITE_COMPANY_REGION,
          addressLocality: SITE_COMPANY_LOCALITY,
        },
        founder: { "@id": PERSON_ID },
      },
      {
        "@type": "Person",
        "@id": PERSON_ID,
        name: SITE_OWNER_NAME,
        alternateName: SITE_OWNER_NAME_EN,
        jobTitle: [hpPublicContent.hero.title, "Colorist"],
        url: SITE_URL,
        worksFor: { "@id": ORGANIZATION_ID },
        sameAs: hpPublicContent.profile.socialLinks.map((link) => link.href),
      },
    ],
  }
}

type NoteJsonLdInput = {
  slug: string
  title: string
  description: string
  lastEditedTime: string
  publishedAt?: string
  imageUrl?: string
}

export function buildNoteJsonLd(note: NoteJsonLdInput) {
  const url = `${SITE_URL}/notes/${note.slug}`
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: note.title,
    description: note.description,
    url,
    mainEntityOfPage: url,
    inLanguage: "ja",
    dateModified: note.lastEditedTime,
    ...(note.publishedAt ? { datePublished: note.publishedAt } : {}),
    ...(note.imageUrl ? { image: note.imageUrl } : {}),
    author: { "@type": "Person", "@id": PERSON_ID, name: SITE_OWNER_NAME, url: SITE_URL },
    publisher: { "@type": "Organization", "@id": ORGANIZATION_ID, name: SITE_BRAND_NAME },
  }
}

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  )
}
