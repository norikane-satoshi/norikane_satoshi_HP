"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import {useLocale} from "next-intl"
import { useEffect } from "react"
import { useForm } from "react-hook-form"

import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea"
import {
  formatBookingDateSelection,
  bookingFormSchema,
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

function formatSlot(slot: BookingSlot): string {
  const start = new Date(slot.start)
  const end = new Date(slot.end)
  return `${start.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })} - ${end.toLocaleTimeString("ja-JP", {
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
  const english = locale === "en"
  const {
    formState: { errors, isValid },
    register,
    watch,
  } = useForm<BookingFormData>({
    defaultValues: formData,
    mode: "onChange",
    resolver: zodResolver(bookingFormSchema),
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
              aria-label={english ? `Adjust requested dates: ${formatBookingDateSelection(requestedDateSelection)}` : `${formatBookingDateSelection(requestedDateSelection)} の希望日に戻って調整`}
            >
              {formatBookingDateSelection(requestedDateSelection)}
            </button>
          ) : selectedSlots.length === 0 ? (
            <span className="glass-badge booking-form__slot-pill">{english ? "No dates selected" : "希望日未選択"}</span>
          ) : (
            selectedSlots.map((slot, index) => (
              <button
                type="button"
                key={`${slot.start}-${slot.end}-${index}`}
                className="glass-badge booking-form__slot-pill"
                onClick={() => onReselectDate(slot)}
                aria-label={english ? `Adjust time: ${formatSlot(slot)}` : `${formatSlot(slot)} の時間に戻って調整`}
              >
                {formatSlot(slot)}
              </button>
            ))
          )}
        </div>
        <button className="booking-form__text-link" type="button" onClick={() => onReselectDate()}>
          {english ? "Requested dates" : "希望日"}
        </button>
      </div>
      {selectedSlots.length > 0 ? (
        <div className="booking-form__duration-total glass-inset">
          <span className="booking-form__label">{english ? "Estimated total duration" : "想定作業時間合計"}</span>
          <strong>{formatDurationMinutes(getTotalDurationMinutes(selectedSlots))}</strong>
        </div>
      ) : null}

      <p className="booking-form__callout glass-flat">
        {english ? "Submitting this form does not confirm a booking. We will review your requested dates and contact you directly." : "送信時点では確定予約ではありません。希望日として内容をお預かりし、確認後に直接ご連絡します。"}
      </p>

      <label className="booking-form__group">
        <span className="booking-form__label">{english ? "Project" : "案件名"}</span>
        <input className="glass-input booking-form__control" maxLength={100} {...register("projectTitle")} />
        {errors.projectTitle ? <span className="booking-form__error">{errors.projectTitle.message}</span> : null}
      </label>

      <div className="booking-form__grid">
        <label className="booking-form__group">
          <span className="booking-form__label">
            {english ? "Deadline" : "納期"}
            <span className="booking-form__label-optional">({english ? "optional" : "任意"})</span>
          </span>
          <input className="glass-input booking-form__control" type="date" {...register("dueDate")} />
        </label>
        <label className="booking-form__group">
          <span className="booking-form__label">{english ? "Company" : "会社名"}</span>
          <input className="glass-input booking-form__control" {...register("companyName")} />
        </label>
      </div>

      <div className="booking-form__grid">
        <label className="booking-form__group">
          <span className="booking-form__label">{english ? "Name" : "氏名"}</span>
          <input className="glass-input booking-form__control" {...register("contactName")} />
          {errors.contactName ? <span className="booking-form__error">{errors.contactName.message}</span> : null}
        </label>
        <label className="booking-form__group">
          <span className="booking-form__label">
            {english ? "Email" : "メール"}
            {sessionEmailOptional ? <span className="booking-form__label-optional">({english ? "optional" : "任意"})</span> : null}
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
            <span className="booking-form__label-optional">({english ? "optional" : "任意"})</span>
          </span>
          <input className="glass-input booking-form__control" type="tel" {...register("phone")} />
        </label>
      </div>

      <label className="booking-form__group">
        <span className="booking-form__label">
          {english ? "Notes" : "補足"}
          <span className="booking-form__label-optional">({english ? "optional" : "任意"})</span>
        </span>
        <AutoResizeTextarea className="glass-input booking-form__control" maxLength={1000} maxRows={21} rows={5} {...register("memo")} />
        {errors.memo ? <span className="booking-form__error">{errors.memo.message}</span> : null}
      </label>

      <label className="booking-choice booking-choice--terms glass-flat">
        <input type="checkbox" {...register("agreed")} />
        <span>
          {english ? "I agree to the " : null}
          <a href={`/${locale}/terms`} aria-label={english ? "Open terms of use" : "利用規約を開く"}>
            {english ? "Terms of Use" : "利用規約"}
          </a>
          {english ? null : "に同意します"}
          <span className="booking-choice__legal-separator" aria-hidden="true"> / </span>
          <a href={`/${locale}/privacy`} aria-label={english ? "Open privacy policy" : "プライバシーポリシーを開く"}>
            {english ? "Privacy Policy" : "プライバシーポリシー"}
          </a>
        </span>
      </label>
      {errors.agreed ? <span className="booking-form__error">{errors.agreed.message}</span> : null}
    </div>
  )
}
