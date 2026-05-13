"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect } from "react"
import { useForm } from "react-hook-form"

import {
  bookingFormSchema,
  formatDurationMinutes,
  getTotalDurationMinutes,
  type BookingFormData,
  type BookingSlot,
} from "@/lib/booking/domain/form-schema"


type BookingFormProps = {
  formData: BookingFormData
  selectedSlots: BookingSlot[]
  onChange: (data: BookingFormData) => void
  onValidityChange: (isValid: boolean) => void
  onReselectDate: (slot?: BookingSlot) => void
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
  onChange,
  onValidityChange,
  onReselectDate,
}: BookingFormProps) {
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
    const subscription = watch((value) => onChange(value as BookingFormData))
    return () => subscription.unsubscribe()
  }, [onChange, watch])

  useEffect(() => {
    onValidityChange(isValid)
  }, [isValid, onValidityChange])

  return (
    <div className="booking-form">
      <div className="booking-form__slot-row">
        <div className="booking-form__slot-list">
          {selectedSlots.length === 0 ? (
            <span className="glass-badge booking-form__slot-pill">日時未選択</span>
          ) : (
            selectedSlots.map((slot, index) => (
              <button
                type="button"
                key={`${slot.start}-${slot.end}-${index}`}
                className="glass-badge booking-form__slot-pill"
                onClick={() => onReselectDate(slot)}
                aria-label={`${formatSlot(slot)} の時間に戻って調整`}
              >
                {formatSlot(slot)}
              </button>
            ))
          )}
        </div>
        <button className="booking-form__text-link" type="button" onClick={() => onReselectDate()}>
          選択日時
        </button>
      </div>
      <div className="booking-form__duration-total glass-inset">
        <span className="booking-form__label">想定作業時間合計</span>
        <strong>{formatDurationMinutes(getTotalDurationMinutes(selectedSlots))}</strong>
      </div>

      <p className="booking-form__callout glass-flat">
        本予約はお申し込み時点では確定ではありません。内容を確認のうえ、確定のご連絡を別途お送りします。確定までしばらくお時間をいただきます
      </p>

      <label className="booking-form__group">
        <span className="booking-form__label">案件名</span>
        <input className="glass-input booking-form__control" maxLength={100} {...register("projectTitle")} />
        {errors.projectTitle ? <span className="booking-form__error">{errors.projectTitle.message}</span> : null}
      </label>

      <div className="booking-form__grid">
        <label className="booking-form__group">
          <span className="booking-form__label">納期</span>
          <input className="glass-input booking-form__control" type="date" {...register("dueDate")} />
        </label>
        <label className="booking-form__group">
          <span className="booking-form__label">会社名</span>
          <input className="glass-input booking-form__control" {...register("companyName")} />
        </label>
      </div>

      <div className="booking-form__grid">
        <label className="booking-form__group">
          <span className="booking-form__label">担当者氏名</span>
          <input className="glass-input booking-form__control" {...register("contactName")} />
          {errors.contactName ? <span className="booking-form__error">{errors.contactName.message}</span> : null}
        </label>
        <label className="booking-form__group">
          <span className="booking-form__label">メールアドレス</span>
          <input className="glass-input booking-form__control booking-form__control--readonly" readOnly {...register("sessionEmail")} />
        </label>
      </div>

      <div className="booking-form__grid">
        <label className="booking-form__group">
          <span className="booking-form__label">連絡用メール</span>
          <input className="glass-input booking-form__control" type="email" {...register("contactEmail")} />
          {errors.contactEmail ? <span className="booking-form__error">{errors.contactEmail.message}</span> : null}
        </label>
        <label className="booking-form__group">
          <span className="booking-form__label">
            電話番号
            <span className="booking-form__label-optional">(任意)</span>
          </span>
          <input className="glass-input booking-form__control" type="tel" {...register("phone")} />
        </label>
      </div>

      <label className="booking-form__group">
        <span className="booking-form__label">補足メモ</span>
        <textarea className="glass-input booking-form__control" maxLength={1000} rows={5} {...register("memo")} />
        {errors.memo ? <span className="booking-form__error">{errors.memo.message}</span> : null}
      </label>

      <label className="booking-choice booking-choice--terms glass-flat">
        <input type="checkbox" {...register("agreed")} />
        <span>
          <a href="#" onClick={(event) => event.preventDefault()}>
            利用規約
          </a>
          に同意します
        </span>
      </label>
      {errors.agreed ? <span className="booking-form__error">{errors.agreed.message}</span> : null}
    </div>
  )
}
