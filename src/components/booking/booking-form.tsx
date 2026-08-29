"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import {useLocale} from "next-intl"
import { useEffect, useMemo } from "react"
import { useForm } from "react-hook-form"

import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea"
import {getLocalizedCopy} from "@/i18n/copy"
import {
  formatBookingDateSelection,
  createBookingFormSchema,
  formatDurationMinutes,
  getTotalDurationMinutes,
  type BookingDateSelection,
  type BookingFormData,
  type BookingSlot,
} from "@/lib/booking/domain/form-schema"


type BookingFormProps = {
  formData: BookingFormData
  selectedSlots: BookingSlot[]
  requestedDateSelection?: BookingDateSelection | null
  onChange: (data: Partial<BookingFormData>) => void
  onValidityChange: (isValid: boolean) => void
  onReselectDate: (slot?: BookingSlot) => void
  sessionEmailReadOnly?: boolean
  sessionEmailOptional?: boolean
}

function formatSlot(slot: BookingSlot, locale: "ja" | "en"): string {
  const start = new Date(slot.start)
  const end = new Date(slot.end)
  const intlLocale = locale === "en" ? "en-US" : "ja-JP"
  return `${start.toLocaleString(intlLocale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })} - ${end.toLocaleTimeString(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
  })}`
}

export function BookingForm({
  formData,
  selectedSlots,
  requestedDateSelection = null,
  onChange,
  onValidityChange,
  onReselectDate,
  sessionEmailReadOnly = true,
  sessionEmailOptional = false,
}: BookingFormProps) {
  const locale = useLocale() as "ja" | "en"
  const copy = getLocalizedCopy(locale, "Booking")
  const resolver = useMemo(() => zodResolver(createBookingFormSchema(locale)), [locale])
  const {
    formState: { errors, isValid },
    register,
    watch,
  } = useForm<BookingFormData>({
    defaultValues: formData,
    mode: "onChange",
    resolver,
    values: formData,
  })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/incompatible-library
    const subscription = watch((value) => onChange(value))
    return () => subscription.unsubscribe()
  }, [onChange, watch])

  useEffect(() => {
    onValidityChange(isValid)
  }, [isValid, onValidityChange])

  return (
    <div className="booking-form">
      <div className="booking-form__slot-row">
        <div className="booking-form__slot-list">
          {requestedDateSelection ? (
            <button
              type="button"
              className="glass-badge booking-form__slot-pill"
              onClick={() => onReselectDate()}
              aria-label={copy.adjustDates.replace("{selection}", formatBookingDateSelection(requestedDateSelection, locale))}
            >
              {formatBookingDateSelection(requestedDateSelection, locale)}
            </button>
          ) : selectedSlots.length === 0 ? (
            <span className="glass-badge booking-form__slot-pill">{copy.noDates}</span>
          ) : (
            selectedSlots.map((slot, index) => (
              <button
                type="button"
                key={`${slot.start}-${slot.end}-${index}`}
                className="glass-badge booking-form__slot-pill"
                onClick={() => onReselectDate(slot)}
                aria-label={copy.adjustTime.replace("{slot}", formatSlot(slot, locale))}
              >
                {formatSlot(slot, locale)}
              </button>
            ))
          )}
        </div>
        <button className="booking-form__text-link" type="button" onClick={() => onReselectDate()}>
          {copy.requestedDates}
        </button>
      </div>
      {selectedSlots.length > 0 ? (
        <div className="booking-form__duration-total glass-inset">
          <span className="booking-form__label">{copy.estimatedDuration}</span>
          <strong>{formatDurationMinutes(getTotalDurationMinutes(selectedSlots), locale)}</strong>
        </div>
      ) : null}

      <p className="booking-form__callout glass-flat">
        {copy.submissionNotice}
      </p>

      <label className="booking-form__group">
        <span className="booking-form__label">{copy.project}</span>
        <input className="glass-input booking-form__control" maxLength={100} {...register("projectTitle")} />
        {errors.projectTitle ? <span className="booking-form__error">{errors.projectTitle.message}</span> : null}
      </label>

      <div className="booking-form__grid">
        <label className="booking-form__group">
          <span className="booking-form__label">
            {copy.deadline}
            <span className="booking-form__label-optional">({copy.optional})</span>
          </span>
          <input className="glass-input booking-form__control" type="date" {...register("dueDate")} />
        </label>
        <label className="booking-form__group">
          <span className="booking-form__label">{copy.company}</span>
          <input className="glass-input booking-form__control" {...register("companyName")} />
        </label>
      </div>

      <div className="booking-form__grid">
        <label className="booking-form__group">
          <span className="booking-form__label">{copy.name}</span>
          <input className="glass-input booking-form__control" {...register("contactName")} />
          {errors.contactName ? <span className="booking-form__error">{errors.contactName.message}</span> : null}
        </label>
        <label className="booking-form__group">
          <span className="booking-form__label">
            {copy.email}
            {sessionEmailOptional ? <span className="booking-form__label-optional">({copy.optional})</span> : null}
          </span>
          <input
            className={`glass-input booking-form__control${sessionEmailReadOnly ? " booking-form__control--readonly" : ""}`}
            readOnly={sessionEmailReadOnly}
            type="email"
            {...register("sessionEmail")}
          />
          {errors.sessionEmail ? <span className="booking-form__error">{errors.sessionEmail.message}</span> : null}
        </label>
      </div>

      <div className="booking-form__grid">
        <label className="booking-form__group">
          <span className="booking-form__label">
            TEL
            <span className="booking-form__label-optional">({copy.optional})</span>
          </span>
          <input className="glass-input booking-form__control" type="tel" {...register("phone")} />
        </label>
      </div>

      <label className="booking-form__group">
        <span className="booking-form__label">
          {copy.notes}
          <span className="booking-form__label-optional">({copy.optional})</span>
        </span>
        <AutoResizeTextarea className="glass-input booking-form__control" maxLength={1000} maxRows={21} rows={5} {...register("memo")} />
        {errors.memo ? <span className="booking-form__error">{errors.memo.message}</span> : null}
      </label>

      <label className="booking-choice booking-choice--terms glass-flat">
        <input type="checkbox" {...register("agreed")} />
        <span>
          {copy.agreePrefix}
          <a href={`/${locale}/terms`} aria-label={copy.openTerms}>
            {copy.terms}
          </a>
          {copy.agreeSuffix}
          <span className="booking-choice__legal-separator" aria-hidden="true"> / </span>
          <a href={`/${locale}/privacy`} aria-label={copy.openPrivacy}>
            {copy.privacy}
          </a>
        </span>
      </label>
      {errors.agreed ? <span className="booking-form__error">{errors.agreed.message}</span> : null}
    </div>
  )
}
