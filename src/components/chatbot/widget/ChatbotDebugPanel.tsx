"use client"

import { Check, Copy, RefreshCw, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import type { ChatbotAuditDebug, ChatbotLifecycleDebug, ChatbotResponseTier, WidgetUi } from "./api"
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
  lifecycle?: ChatbotLifecycleDebug
  audit?: ChatbotAuditDebug
}

export type ChatbotDebugSnapshot = {
  displayMode: WidgetDisplayMode
  isDesktopLayout: boolean
  requestState: "idle" | "submitting" | "delayed" | "recoverable"
  activeUiKind: WidgetUi["kind"]
  messageCount: number
  hasClientSession: boolean
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

type ChatbotAuditReadback = {
  status: "complete" | "pending" | "failed"
  eventCount: number
  missingEvents: string[]
  failedEvents: string[]
}

type ClipboardAdapters = {
  writeText?: (text: string) => Promise<void>
  fallbackCopy?: (text: string) => boolean
}

export function isLocalChatbotDebugHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1")
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1"
}

export function shouldAutoOpenChatbotDebug(location: Pick<Location, "hostname" | "search">): boolean {
  if (!isLocalChatbotDebugHost(location.hostname)) return false
  return new URLSearchParams(location.search).get("chatbotDebug") === "1"
}

export async function copyChatbotDiagnosticsText(text: string, adapters: ClipboardAdapters = {}): Promise<void> {
  const writeText = adapters.writeText ?? navigator.clipboard?.writeText.bind(navigator.clipboard)
  if (writeText) {
    try {
      await writeText(text)
      return
    } catch {
      // Some local browser surfaces deny the async Clipboard API; use the selection fallback below.
    }
  }

  const fallbackCopy = adapters.fallbackCopy ?? copyWithTemporaryTextarea
  if (!fallbackCopy(text)) throw new Error("clipboard_copy_failed")
}

function copyWithTemporaryTextarea(text: string): boolean {
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.inset = "-9999px auto auto -9999px"
  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  try {
    return document.execCommand("copy")
  } finally {
    textarea.remove()
  }
}

export function ChatbotDebugPanel({ snapshot, onClose }: ChatbotDebugPanelProps) {
  const [buildInfo, setBuildInfo] = useState<ChatbotBuildInfo | null>(null)
  const [buildInfoError, setBuildInfoError] = useState<string | null>(null)
  const [isLoadingBuildInfo, setIsLoadingBuildInfo] = useState(false)
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle")
  const [auditReadback, setAuditReadback] = useState<ChatbotAuditReadback | null>(null)

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

  useEffect(() => {
    const requestId = snapshot.lastRequest?.requestId
    if (!requestId) return
    let cancelled = false
    void fetch(`/api/chatbot/audit-summary?correlationId=${encodeURIComponent(requestId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json() as ChatbotAuditReadback
      })
      .then((value) => {
        if (!cancelled) setAuditReadback(value)
      })
      .catch(() => {
        if (!cancelled) setAuditReadback(null)
      })
    return () => {
      cancelled = true
    }
  }, [snapshot.lastRequest?.requestId])

  const copyDiagnostics = async () => {
    try {
      const safeBuildInfo = buildInfo
        ? {
            commitSha: buildInfo.commitSha,
            expectedRef: buildInfo.expectedRef,
            buildTime: buildInfo.buildTime,
            commitShaSource: buildInfo.commitShaSource,
            expectedRefSource: buildInfo.expectedRefSource,
          }
        : null
      await copyChatbotDiagnosticsText(JSON.stringify({ buildInfo: safeBuildInfo, snapshot, auditReadback }, null, 2))
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
    ["Audit schema", snapshot.lastRequest?.audit?.schemaVersion],
    ["Audit persistence", auditReadback?.status ?? snapshot.lastRequest?.audit?.persistenceStatus],
    ["Audit event count", auditReadback?.eventCount ?? snapshot.lastRequest?.audit?.eventCount],
    ["Audit missing events", auditReadback?.missingEvents.join(",")],
    ["Audit failed events", auditReadback?.failedEvents.join(",")],
    ["Conversation load", formatDuration(snapshot.lastRequest?.audit?.stageTimings.conversationLoad)],
    ["Context preparation", formatDuration(snapshot.lastRequest?.audit?.stageTimings.contextPreparation)],
    ["Tier health check", formatDuration(snapshot.lastRequest?.audit?.stageTimings.tierHealthCheck)],
    ["Worker queue wait", formatDuration(snapshot.lastRequest?.audit?.stageTimings.workerQueueWait)],
    ["CDP target session", formatDuration(snapshot.lastRequest?.audit?.stageTimings.cdpTargetSession)],
    ["Runtime context preparation", formatDuration(snapshot.lastRequest?.audit?.stageTimings.runtimeContextPreparation)],
    ["Prompt to first chunk", formatDuration(snapshot.lastRequest?.audit?.stageTimings.promptToFirstChunk)],
    ["Response streaming", formatDuration(snapshot.lastRequest?.audit?.stageTimings.responseStreaming)],
    ["Output validation", formatDuration(snapshot.lastRequest?.audit?.stageTimings.outputValidation)],
    ["Notion inference", formatDuration(snapshot.lastRequest?.audit?.stageTimings.notionInference)],
    ["Response normalization", formatDuration(snapshot.lastRequest?.audit?.stageTimings.responseNormalization)],
    ["Conversation persist", formatDuration(snapshot.lastRequest?.audit?.stageTimings.conversationPersist)],
    ["Slack notification", formatDuration(snapshot.lastRequest?.audit?.stageTimings.slackNotification)],
    ["Total server", formatDuration(snapshot.lastRequest?.audit?.stageTimings.totalServer)],
    ["Conversation scope hash", snapshot.lastRequest?.lifecycle?.conversationScopeHash],
    ["Thread ID hash", snapshot.lastRequest?.lifecycle?.threadIdHash],
    ["Thread version", snapshot.lastRequest?.lifecycle?.threadVersion],
    ["Thread visibility", snapshot.lastRequest?.lifecycle?.visibilityStatus],
    ["Thread alive", snapshot.lastRequest?.lifecycle?.alive],
    ["Deleted at", snapshot.lastRequest?.lifecycle?.deletedAt],
    ["Retention deadline", snapshot.lastRequest?.lifecycle?.estimatedRetentionDeadline],
    ["Hidden from chat list", snapshot.lastRequest?.lifecycle?.hiddenFromChatList],
    ["Hide attempts", snapshot.lastRequest?.lifecycle?.hideAttemptCount],
    ["Hide verification", snapshot.lastRequest?.lifecycle?.hideVerificationResult],
    ["Post-hide inference verified", snapshot.lastRequest?.lifecycle?.postHideInferenceVerified],
    ["Thread record missing", snapshot.lastRequest?.lifecycle?.threadRecordMissing],
    ["Retention purge detected", snapshot.lastRequest?.lifecycle?.retentionPurgeDetected],
    ["Thread reprovisioned", snapshot.lastRequest?.lifecycle?.threadReprovisioned],
    ["Context rebuilt from HP DB", snapshot.lastRequest?.lifecycle?.contextRebuiltFromHpDb],
    ["Tier fallback reason", snapshot.lastRequest?.lifecycle?.tierFallbackReason],
    ["Completed at", snapshot.lastRequest?.completedAt],
    ["Client session present", snapshot.hasClientSession],
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
            aria-label={
              copyState === "copied"
                ? "診断JSONをコピーしました"
                : copyState === "failed"
                  ? "診断JSONをコピーできませんでした"
                  : "診断JSONをコピー"
            }
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
      {copyState !== "idle" ? (
        <p
          className={`mt-2 text-[10px] ${copyState === "copied" ? "text-hp-muted" : "text-[var(--hp-color-error)]"}`}
          role="status"
        >
          {copyState === "copied" ? "診断JSONをコピーしました。" : "診断JSONをコピーできませんでした。"}
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

function formatDuration(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value} ms`
}
