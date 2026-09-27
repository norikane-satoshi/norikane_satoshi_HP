import type {ReactNode} from "react"
import {getLocalizedCopy, type AppMessages} from "@/i18n/copy"

type LegalHeadingLevel = "h1" | "h2"

type LegalContentProps = {
  headingLevel?: LegalHeadingLevel
  locale?: "ja" | "en"
}

type LegalCopy = AppMessages["Legal"]["privacy"]

function LegalHeading({as: Tag, children}: {as: LegalHeadingLevel; children: ReactNode}) {
  return <Tag className="mt-2 text-3xl font-bold text-hp md:text-4xl">{children}</Tag>
}

function LegalDocument({copy, headingLevel}: {copy: LegalCopy; headingLevel: LegalHeadingLevel}) {
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-hp-muted">{copy.eyebrow}</p>
      <LegalHeading as={headingLevel}>{copy.title}</LegalHeading>
      <p className="mt-4 text-sm leading-7 text-hp-muted">{copy.intro}</p>
      <div className="mt-10 space-y-8 text-sm leading-7 text-hp">
        {copy.sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-lg font-semibold text-hp">{section.title}</h2>
            <p className="mt-3 text-hp-muted">{section.body}</p>
          </section>
        ))}
      </div>
      <p className="mt-10 text-xs text-hp-muted">{copy.revised}</p>
    </>
  )
}

export function PrivacyPolicyContent({headingLevel = "h1", locale = "ja"}: LegalContentProps) {
  return <LegalDocument copy={getLocalizedCopy(locale, "Legal").privacy} headingLevel={headingLevel} />
}

export function TermsContent({headingLevel = "h1", locale = "ja"}: LegalContentProps) {
  return <LegalDocument copy={getLocalizedCopy(locale, "Legal").terms} headingLevel={headingLevel} />
}
