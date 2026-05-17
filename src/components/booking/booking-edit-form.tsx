"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Save, Trash2, XCircle } from "lucide-react"

import type {
  BookingAccessScope,
  EditableBookingDetails,
  EditableBookingTimeSlot,
} from "@/lib/booking/server/edit-access"

type BookingEditFormProps = {
  bookingId: string
  bookingGroupId: string
  initialDetails: EditableBookingDetails
  initialTimeSlots: EditableBookingTimeSlot[]
  scope: BookingAccessScope
  isCalendarAdmin: boolean
  isPast: boolean
}

type DetailState = {
  projectTitle: string
  contactName: string
  companyName: string
  contactEmail: string
  phone: string
  memo: string
  dueDate: string
}

type SlotState = {
  id: string
  startTime: string
  endTime: string
}

const POLICY_TEXT = "本予約のキャンセルおよび日時変更は、別途締結する業務委託契約書に記載のキャンセルポリシーをご確認ください。"

function toDateTimeLocal(value: string): string {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000)
  return local.toISOString().slice(0, 16)
}

function fromDateTimeLocal(value: string): string {
  return new Date(value).toISOString()
}

function toDetailsState(details: EditableBookingDetails): DetailState {
  return {
    projectTitle: details.projectTitle,
    contactName: details.contactName,
    companyName: details.companyName ?? "",
    contactEmail: details.contactEmail ?? "",
    phone: details.phone ?? "",
    memo: details.memo ?? "",
    dueDate: details.dueDate ?? "",
  }
}

function toSlotState(slot: EditableBookingTimeSlot): SlotState {
  return {
    id: slot.id,
    startTime: toDateTimeLocal(slot.startTime),
    endTime: toDateTimeLocal(slot.endTime),
  }
}

export function BookingEditForm({
  bookingId,
  bookingGroupId,
  initialDetails,
  initialTimeSlots,
  scope,
  isCalendarAdmin,
  isPast,
}: BookingEditFormProps) {
  const router = useRouter()
  const initialDetailState = useMemo(() => toDetailsState(initialDetails), [initialDetails])
  const initialSlotState = useMemo(() => initialTimeSlots.map(toSlotState), [initialTimeSlots])
  const [details, setDetails] = useState<DetailState>(initialDetailState)
  const [slots, setSlots] = useState<SlotState[]>(initialSlotState)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canOperate = (scope === "owner" || scope === "admin") && (scope === "admin" || !isPast)
  const isReadOnly = !canOperate
  const readOnlyMessage = scope === "team"
    ? "同じチャンネルのメンバーの予約のため閲覧のみ可能です"
    : isPast && scope !== "admin"
      ? "過去の予約は管理者のみ編集できます"
      : null

  const updateDetail = (key: keyof DetailState, value: string) => {
    setDetails((current) => ({ ...current, [key]: value }))
  }

  const updateSlot = (slotId: string, key: "startTime" | "endTime", value: string) => {
    setSlots((current) => current.map((slot) => (slot.id === slotId ? { ...slot, [key]: value } : slot)))
  }

  async function requireOk(response: Response) {
    if (response.ok) return
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? `request_failed_${response.status}`)
  }

  const saveBooking = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canOperate || saving) return
    setSaving(true)
    setError(null)
    try {
      await requireOk(await fetch(`/api/booking/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_details",
          ...details,
        }),
      }))

      for (const slot of slots) {
        const original = initialSlotState.find((item) => item.id === slot.id)
        if (!original || (original.startTime === slot.startTime && original.endTime === slot.endTime)) continue
        await requireOk(await fetch(`/api/booking/${slot.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "move",
            start: fromDateTimeLocal(slot.startTime),
            end: fromDateTimeLocal(slot.endTime),
          }),
        }))
      }
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "unknown")
    } finally {
      setSaving(false)
    }
  }

  const cancelBooking = async () => {
    if (!canOperate || saving) return
    setSaving(true)
    setError(null)
    try {
      await requireOk(await fetch(`/api/booking/${bookingId}`, { method: "DELETE" }))
      router.push("/booking")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "unknown")
      setSaving(false)
    }
  }

  const hardDeleteBooking = async () => {
    if (!isCalendarAdmin || saving) return
    setSaving(true)
    setError(null)
    try {
      await requireOk(await fetch(`/api/booking/${bookingId}?mode=hard`, { method: "DELETE" }))
      router.push("/booking")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "unknown")
      setSaving(false)
    }
  }

  return (
    <form className="space-y-8" onSubmit={saveBooking}>
      {readOnlyMessage ? (
        <p className="glass-flat rounded-2xl px-4 py-3 text-sm font-medium text-hp">{readOnlyMessage}</p>
      ) : null}
      {error ? (
        <p className="glass-flat rounded-2xl px-4 py-3 text-sm font-medium text-[var(--accent-pink)]" role="alert">
          {error}
        </p>
      ) : null}

      <section className="glass-flat rounded-3xl p-5 md:p-6">
        <h2 className="text-lg font-semibold text-hp">予約情報</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-hp">
            <span>案件名</span>
            <input className="glass-input w-full px-4 py-3 text-sm" value={details.projectTitle} disabled={isReadOnly} onChange={(event) => updateDetail("projectTitle", event.target.value)} />
          </label>
          <label className="space-y-2 text-sm font-medium text-hp">
            <span>担当者氏名</span>
            <input className="glass-input w-full px-4 py-3 text-sm" value={details.contactName} disabled={isReadOnly} onChange={(event) => updateDetail("contactName", event.target.value)} />
          </label>
          <label className="space-y-2 text-sm font-medium text-hp">
            <span>会社名</span>
            <input className="glass-input w-full px-4 py-3 text-sm" value={details.companyName} disabled={isReadOnly} onChange={(event) => updateDetail("companyName", event.target.value)} />
          </label>
          <label className="space-y-2 text-sm font-medium text-hp">
            <span>連絡用メール</span>
            <input className="glass-input w-full px-4 py-3 text-sm" type="email" value={details.contactEmail} disabled={isReadOnly} onChange={(event) => updateDetail("contactEmail", event.target.value)} />
          </label>
          <label className="space-y-2 text-sm font-medium text-hp">
            <span>電話番号</span>
            <input className="glass-input w-full px-4 py-3 text-sm" type="tel" value={details.phone} disabled={isReadOnly} onChange={(event) => updateDetail("phone", event.target.value)} />
          </label>
          <label className="space-y-2 text-sm font-medium text-hp">
            <span>納期</span>
            <input className="glass-input w-full px-4 py-3 text-sm" type="date" value={details.dueDate} disabled={isReadOnly} onChange={(event) => updateDetail("dueDate", event.target.value)} />
          </label>
        </div>
        <label className="mt-4 block space-y-2 text-sm font-medium text-hp">
          <span>補足メモ</span>
          <textarea className="glass-input w-full px-4 py-3 text-sm" rows={5} value={details.memo} disabled={isReadOnly} onChange={(event) => updateDetail("memo", event.target.value)} />
        </label>
      </section>

      <section className="glass-flat rounded-3xl p-5 md:p-6">
        <h2 className="text-lg font-semibold text-hp">日時</h2>
        <div className="mt-5 space-y-4">
          {slots.map((slot, index) => (
            <div key={slot.id} className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm font-medium text-hp">
                <span>{`開始 ${index + 1}`}</span>
                <input className="glass-input w-full px-4 py-3 text-sm" type="datetime-local" value={slot.startTime} disabled={isReadOnly} onChange={(event) => updateSlot(slot.id, "startTime", event.target.value)} />
              </label>
              <label className="space-y-2 text-sm font-medium text-hp">
                <span>{`終了 ${index + 1}`}</span>
                <input className="glass-input w-full px-4 py-3 text-sm" type="datetime-local" value={slot.endTime} disabled={isReadOnly} onChange={(event) => updateSlot(slot.id, "endTime", event.target.value)} />
              </label>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        {canOperate ? (
          <button className="glass-btn inline-flex min-h-11 items-center gap-2 px-5 py-3 text-sm font-semibold text-hp disabled:opacity-50" type="submit" disabled={saving}>
            <Save aria-hidden="true" size={18} />
            <span>{saving ? "保存中" : "保存"}</span>
          </button>
        ) : null}
        <button className="glass-flat inline-flex min-h-11 items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold text-hp" type="button" onClick={() => router.push("/booking")}>
          予約カレンダーへ戻る
        </button>
      </div>

      {canOperate ? (
        <section className="glass-flat rounded-3xl p-5 md:p-6">
          <p className="text-sm leading-7 text-hp-muted">{POLICY_TEXT}</p>
          <button className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--accent-pink)] px-5 py-3 text-sm font-semibold text-[var(--accent-pink)] disabled:opacity-50" type="button" onClick={cancelBooking} disabled={saving}>
            <XCircle aria-hidden="true" size={18} />
            <span>予約をキャンセル</span>
          </button>
        </section>
      ) : null}

      {isCalendarAdmin ? (
        <section className="glass-flat rounded-3xl p-5 md:p-6">
          <p className="text-sm text-hp-muted">{bookingGroupId}</p>
          <button className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--accent-pink)] px-5 py-3 text-sm font-semibold text-[var(--accent-pink)] disabled:opacity-50" type="button" onClick={hardDeleteBooking} disabled={saving}>
            <Trash2 aria-hidden="true" size={18} />
            <span>DB から完全削除</span>
          </button>
        </section>
      ) : null}
    </form>
  )
}
