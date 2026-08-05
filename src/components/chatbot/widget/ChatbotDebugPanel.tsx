"use client"

import { Check, Copy, RefreshCw, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import type { ChatbotResponseTier, WidgetUi } from "./api"
import type { WidgetDisplayMode } from "./useWidgetState"

export type ChatbotDebugRequest = {
  operation: "message" | "message-edit" | "message-recovery" | "inquiry" | "booking-completed"
  outcome: "success" | "failure" | "cancelled"
  completedAt: string
  durationMs?: number
  requestId?: string
  tier?: ChatbotResponseTier
  status?: number
  stage?: string
  retryable?: boolean
  fallback?: string
}

export type ChatbotDebugSnapshot = {
  displayMode: WidgetDisplayMode
  isDesktopLayout: boolean
  requestState: "idle" | "submitting" | "delayed" | "recoverable"
  activeUiKind: WidgetUi["kind"]
  messageCount: number
  conversationId?: string
  clientSessionId: string
  pendingRequestKind?: string
  recoverableRequestKind?: string
  lastRequest?: ChatbotDebugRequest
}

type ChatbotBuildInfo = {
  commitSha: string
  worktreePath: string
  expectedRef: string
  buildTime: string
  commitShaSource: string
  expectedRefSource: string
}

type ChatbotDebugPanelProps = {
  snapshot: ChatbotDebugSnapshot
  onClose: () => void
}

export function isLocalChatbotDebugHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1")
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1"
}

export function shouldAutoOpenChatbotDebug(location: Pick<Location, "hostname" | "search">): boolean {
  if (!isLocalChatbotDebugHost(location.hostname)) return false
  return new URLSearchParams(location.search).get("chatbotDebug") === "1"
}

export function ChatbotDebugPanel({ snapshot, onClose }: ChatbotDebugPanelProps) {
  const [buildInfo, setBuildInfo] = useState<ChatbotBuildInfo | null>(null)
  const [buildInfoError, setBuildInfoError] = useState<string | null>(null)
  const [isLoadingBuildInfo, setIsLoadingBuildInfo] = useState(false)
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle")

  const refreshBuildInfo = useCallback(async () => {
    setIsLoadingBuildInfo(true)
    setBuildInfoError(null)
    try {
      const response = await fetch("/api/chatbot/build-info", { cache: "no-store" })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setBuildInfo((await response.json()) as ChatbotBuildInfo)
    } catch (error) {
      setBuildInfo(null)
      setBuildInfoError(error instanceof Error ? error.message : "取得失敗")
    } finally {
      setIsLoadingBuildInfo(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the panel synchronizes browser state with the build-info endpoint on mount.
    void refreshBuildInfo()
  }, [refreshBuildInfo])

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ buildInfo, snapshot }, null, 2))
      setCopyState("copied")
    } catch {
      setCopyState("failed")
    }
  }

  const rows: Array<[string, string | number | boolean | undefined]> = [
    ["Build SHA", buildInfo?.commitSha],
    ["Expected ref", buildInfo?.expectedRef],
    ["Build source", buildInfo ? `${buildInfo.commitShaSource} / ${buildInfo.expectedRefSource}` : undefined],
    ["Build time", buildInfo?.buildTime],
    ["Worktree", buildInfo?.worktreePath],
    ["Request state", snapshot.requestState],
    ["Last operation", snapshot.lastRequest?.operation],
    ["Last outcome", snapshot.lastRequest?.outcome],
    ["Request ID", snapshot.lastRequest?.requestId],
    ["Response tier", snapshot.lastRequest?.tier],
    ["Duration", snapshot.lastRequest?.durationMs === undefined ? undefined : `${snapshot.lastRequest.durationMs} ms`],
    ["HTTP status", snapshot.lastRequest?.status],
    ["Failure stage", snapshot.lastRequest?.stage],
    ["Retryable", snapshot.lastRequest?.retryable],
    ["Fallback", snapshot.lastRequest?.fallback],
    ["Completed at", snapshot.lastRequest?.completedAt],
    ["Conversation ID", snapshot.conversationId],
    ["Client session", snapshot.clientSessionId],
    ["Active UI", snapshot.activeUiKind],
    ["Display mode", `${snapshot.displayMode} / ${snapshot.isDesktopLayout ? "desktop" : "mobile"}`],
    ["Pending", snapshot.pendingRequestKind],
    ["Recoverable", snapshot.recoverableRequestKind],
    ["Message count", snapshot.messageCount],
  ]

  return (
    <section
      className="max-h-[240px] overflow-y-auto border-b border-[var(--glass-border)] bg-white/35 px-5 py-3"
      aria-label="チャットボット診断情報"
      data-chatbot-debug="open"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-hp">ローカル診断</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-hp-muted">ループバック環境でのみ有効。顧客情報は表示しません。</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void refreshBuildInfo()}
            className="glass-btn flex h-8 w-8 items-center justify-center"
            aria-label="ビルド情報を再取得"
            disabled={isLoadingBuildInfo}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoadingBuildInfo ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void copyDiagnostics()}
            className="glass-btn flex h-8 w-8 items-center justify-center"
            aria-label="診断JSONをコピー"
          >
            {copyState === "copied" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="glass-btn flex h-8 w-8 items-center justify-center"
            aria-label="診断情報を閉じる"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
      {buildInfoError ? (
        <p className="mt-2 text-[10px] text-[var(--hp-color-error)]" role="status">
          Build info: {buildInfoError}
        </p>
      ) : null}
      <dl className="mt-3 grid grid-cols-[max-content,minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[12px] border border-white/55 bg-white/40 p-3 font-[var(--font-geist-mono)] text-[10px] leading-relaxed">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-hp-muted">{label}</dt>
            <dd className="hp-technical-break min-w-0 text-hp">{value === undefined || value === "" ? "-" : String(value)}</dd>
          </div>
        ))}
      </dl>
      <span className="sr-only" aria-live="polite">
        {copyState === "copied" ? "診断JSONをコピーしました" : copyState === "failed" ? "診断JSONをコピーできませんでした" : ""}
      </span>
    </section>
  )
}
