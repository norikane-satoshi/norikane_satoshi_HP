"use client"

import { FormEvent, useState } from "react"

import type { RoutingDecision } from "@/lib/chatbot/domain/routing-decision"
import {
  CHATBOT_CONVERSATION_CONTENT_CLASS_NAME,
  CHATBOT_CONVERSATION_CONTENT_STYLE,
} from "./conversationTypography"
import {useChatbotCopy} from "./i18n"

type DirectContactReason = Extract<RoutingDecision, { kind: "to-direct-contact" }>["reason"]

type DirectContactCardProps = {
  reason: DirectContactReason
  suggestedMessage: string
  onSubmitEmail: (email: string, companyName: string, personName: string) => void
}

export function DirectContactCard({ reason, suggestedMessage, onSubmitEmail }: DirectContactCardProps) {
  const copy = useChatbotCopy()
  const reasonLabels: Record<DirectContactReason, string> = {
    "out-of-scope": copy.reasonOutOfScope, "tech-question": copy.reasonTech, "review-request": copy.reasonReview,
    "vfx-cg-heavy": copy.reasonVfx, "tight-deadline": copy.reasonTight, "raw-edit-included": copy.reasonRawEdit,
    "heavy-retouch": copy.reasonRetouch, "plugin-detail": copy.reasonPlugin, pricing: copy.reasonPricing,
    "contract-decision": copy.reasonContract, "personal-life": copy.reasonPersonal, "other-client": copy.reasonOtherClient,
    "confidential-technique": copy.reasonConfidential, complex: copy.reasonComplex,
  }
  const [email, setEmail] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [personName, setPersonName] = useState("")

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedEmail = email.trim()
    if (!isValidEmail(trimmedEmail)) return
    onSubmitEmail(trimmedEmail, companyName.trim(), personName.trim())
  }

  return (
    <section className="glass-inset space-y-4 p-4" aria-label={copy.contactLabel}>
      <div>
        <p className="text-sm font-semibold text-hp">{reasonLabels[reason]}</p>
        <p
          className={`${CHATBOT_CONVERSATION_CONTENT_CLASS_NAME} mt-2 text-sm text-hp-muted`}
          style={CHATBOT_CONVERSATION_CONTENT_STYLE}
        >
          {suggestedMessage}
        </p>
      </div>
      <div className="glass-card-sm space-y-1 px-3 py-3 text-xs leading-relaxed text-hp-muted" aria-label={copy.contactSummary}>
        <p className="font-semibold text-hp">{copy.contactSummary}</p>
        <p>{copy.contactSummaryBody}</p>
        <p>{copy.contactNoSend}</p>
      </div>
      <form className="space-y-3" onSubmit={handleSubmit}>
        <label className="block space-y-1 text-xs font-semibold text-hp">
          <span className="flex items-center gap-2">
            {copy.email}
            <span className="glass-badge px-2 py-0.5 text-[10px]">{copy.required}</span>
          </span>
          <input
            className="glass-input w-full px-3 py-2 text-sm"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            placeholder={copy.emailPlaceholder}
            aria-label={copy.email}
          />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1 text-xs font-semibold text-hp">
            <span className="flex items-center gap-2">
              {copy.company}
              <span className="glass-badge px-2 py-0.5 text-[10px]">{copy.optional}</span>
            </span>
            <input
              className="glass-input w-full px-3 py-2 text-sm"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              aria-label={copy.company}
            />
          </label>
          <label className="block space-y-1 text-xs font-semibold text-hp">
            <span className="flex items-center gap-2">
              {copy.personName}
              <span className="glass-badge px-2 py-0.5 text-[10px]">{copy.optional}</span>
            </span>
            <input
              className="glass-input w-full px-3 py-2 text-sm"
              value={personName}
              onChange={(event) => setPersonName(event.target.value)}
              aria-label={copy.personName}
            />
          </label>
        </div>
        <button type="submit" className="glass-btn px-4 py-2 text-sm font-semibold text-hp">
          {copy.sendContact}
        </button>
      </form>
    </section>
  )
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
}
