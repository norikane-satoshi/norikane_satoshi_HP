"use client"

import { Copy, Link2, Trash2, UserMinus } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"

type TeamMember = {
  userId: string
  name: string | null
  email: string | null
  joinedAt: string
}

type Team = {
  id: string
  name: string
  createdAt: string
  members: TeamMember[]
}

type TeamsPayload = {
  teams?: Team[]
}

const INVITE_MESSAGES: Record<string, string> = {
  accepted: "招待リンクからチャンネルに参加しました。",
  used: "この招待リンクは既に使用済みです。",
  invalid: "招待リンクが無効です。",
}

export function BookingSettings() {
  const searchParams = useSearchParams()
  const inviteStatus = searchParams.get("invite")
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState("")
  const [newTeamName, setNewTeamName] = useState("")
  const [invitationUrl, setInvitationUrl] = useState("")
  const [message, setMessage] = useState<string | null>(inviteStatus ? INVITE_MESSAGES[inviteStatus] ?? null : null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null)

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? teams[0] ?? null,
    [selectedTeamId, teams],
  )

  const loadTeams = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/teams", { cache: "no-store" })
      const payload = (await response.json().catch(() => ({}))) as TeamsPayload
      if (!response.ok) throw new Error("所属チャンネルを取得できませんでした。")
      const nextTeams = payload.teams ?? []
      setTeams(nextTeams)
      setSelectedTeamId((current) => current && nextTeams.some((team) => team.id === current) ? current : nextTeams[0]?.id ?? "")
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "所属チャンネルを取得できませんでした。")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Initial settings data is loaded from the authenticated API after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTeams()
  }, [loadTeams])

  const createTeam = async () => {
    if (!newTeamName.trim() || saving) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTeamName }),
      })
      const payload = (await response.json().catch(() => ({}))) as TeamsPayload & { teamId?: string }
      if (!response.ok) throw new Error("チャンネルを作成できませんでした。")
      setTeams(payload.teams ?? [])
      setSelectedTeamId(payload.teamId ?? "")
      setNewTeamName("")
      setInvitationUrl("")
      setMessage("チャンネルを作成しました。")
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "チャンネルを作成できませんでした。")
    } finally {
      setSaving(false)
    }
  }

  const createInvitation = async () => {
    if (!selectedTeam || saving) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch("/api/team-invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: selectedTeam.id }),
      })
      const payload = (await response.json().catch(() => ({}))) as { url?: string }
      if (!response.ok || !payload.url) throw new Error("招待リンクを発行できませんでした。")
      setInvitationUrl(payload.url)
      setMessage("招待リンクを発行しました。")
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "招待リンクを発行できませんでした。")
    } finally {
      setSaving(false)
    }
  }

  const copyInvitation = async () => {
    if (!invitationUrl) return
    await navigator.clipboard.writeText(invitationUrl)
    setMessage("招待リンクをコピーしました。")
  }

  const leaveTeam = async () => {
    if (!selectedTeam || saving) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch(`/api/teams/${selectedTeam.id}/membership`, { method: "DELETE" })
      if (!response.ok) throw new Error("チャンネルから退出できませんでした。")
      setInvitationUrl("")
      setMessage("チャンネルから退出しました。")
      await loadTeams()
    } catch (leaveError) {
      setError(leaveError instanceof Error ? leaveError.message : "チャンネルから退出できませんでした。")
    } finally {
      setSaving(false)
    }
  }

  const deleteTeam = async () => {
    if (!teamToDelete || saving) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch(`/api/teams/${teamToDelete.id}`, { method: "DELETE" })
      if (!response.ok) throw new Error("チャンネルを削除できませんでした。")
      setTeamToDelete(null)
      setInvitationUrl("")
      setMessage("チャンネルを削除しました。")
      await loadTeams()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "チャンネルを削除できませんでした。")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="booking-settings">
      <div className="booking-settings__create glass-inset">
        <label className="booking-settings__label" htmlFor="team-name">
          新規チャンネル
        </label>
        <div className="booking-settings__create-row">
          <input
            id="team-name"
            className="glass-input booking-settings__input"
            value={newTeamName}
            onChange={(event) => setNewTeamName(event.target.value)}
            placeholder="チャンネル名"
          />
          <button className="glass-btn booking-settings__button" type="button" onClick={createTeam} disabled={saving || !newTeamName.trim()}>
            作成
          </button>
        </div>
      </div>

      {message ? <p className="booking-settings__notice glass-inset">{message}</p> : null}
      {error ? <p className="booking-settings__error glass-inset">{error}</p> : null}

      <div className="booking-settings__grid">
        <div className="booking-settings__panel glass-inset">
          <label className="booking-settings__label" htmlFor="team-select">
            所属チャンネル
          </label>
          <select
            id="team-select"
            className="glass-input booking-settings__select"
            value={selectedTeam?.id ?? ""}
            onChange={(event) => {
              setSelectedTeamId(event.target.value)
              setInvitationUrl("")
            }}
            disabled={loading || teams.length === 0}
          >
            {teams.length === 0 ? <option value="">所属チャンネルなし</option> : null}
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>

          {selectedTeam ? (
            <div className="booking-settings__team-actions">
              <button className="glass-btn booking-settings__button" type="button" onClick={leaveTeam} disabled={saving}>
                <UserMinus aria-hidden="true" size={16} />
                <span>抜ける</span>
              </button>
              <button className="glass-btn booking-settings__button" type="button" onClick={() => setTeamToDelete(selectedTeam)} disabled={saving}>
                <Trash2 aria-hidden="true" size={16} />
                <span>削除</span>
              </button>
            </div>
          ) : null}
        </div>

        <div className="booking-settings__panel glass-inset">
          <div className="booking-settings__panel-head">
            <p className="booking-settings__label">チャンネル詳細</p>
            {selectedTeam ? <span className="glass-badge booking-settings__member-count">{selectedTeam.members.length} 名</span> : null}
          </div>

          {selectedTeam ? (
            <>
              <h2 className="booking-settings__team-name">{selectedTeam.name}</h2>
              <div className="booking-settings__members">
                {selectedTeam.members.map((member) => (
                  <div className="booking-settings__member glass-flat" key={member.userId}>
                    <span>{member.name || member.email || "メンバー"}</span>
                    {member.email ? <small>{member.email}</small> : null}
                  </div>
                ))}
              </div>
              <div className="booking-settings__invite">
                <button className="glass-btn booking-settings__button" type="button" onClick={createInvitation} disabled={saving}>
                  <Link2 aria-hidden="true" size={16} />
                  <span>招待リンク発行</span>
                </button>
                {invitationUrl ? (
                  <div className="booking-settings__copy-row">
                    <input className="glass-input booking-settings__input" value={invitationUrl} readOnly />
                    <button className="glass-btn booking-settings__icon-button" type="button" onClick={copyInvitation} aria-label="招待リンクをコピー">
                      <Copy aria-hidden="true" size={16} />
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <p className="booking-settings__empty">チャンネルはまだありません。</p>
          )}
        </div>
      </div>

      {teamToDelete ? (
        <div className="booking-calendar__modal-backdrop" role="presentation">
          <div className="booking-calendar__modal-card glass-card" role="dialog" aria-modal="true" aria-labelledby="delete-team-title">
            <h2 id="delete-team-title" className="booking-calendar__modal-title">
              チャンネルを削除しますか
            </h2>
            <p className="booking-calendar__modal-message">
              削除すると(1) チャンネルは消える(2) チャンネル表示からメンバーの案件は消える(3) ただし各自の個人履歴には案件が残る
            </p>
            <div className="booking-calendar__modal-actions">
              <button className="booking-calendar__action-button booking-calendar__action-button--ghost" type="button" onClick={() => setTeamToDelete(null)} disabled={saving}>
                キャンセル
              </button>
              <button className="booking-calendar__action-button booking-calendar__action-button--primary" type="button" onClick={deleteTeam} disabled={saving}>
                削除する
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
