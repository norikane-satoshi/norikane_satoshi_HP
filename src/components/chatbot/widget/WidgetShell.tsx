"use client"

import { useState } from "react"
import { Minus, Sparkles } from "lucide-react"

import type { ChatbotMessageRole } from "@/lib/chatbot/domain/conversation"

import { submitChatbotInquiry, submitChatbotMessage, type SubmitInquiryInput, type WidgetUi } from "./api"
import { ChatInput } from "./ChatInput"
import { ChatMessage } from "./ChatMessage"
import { ChatbotBookingCard } from "./ChatbotBookingCard"
import { ChoicePanel } from "./ChoicePanel"
import { DirectContactCard } from "./DirectContactCard"
import { InquiryForm } from "./InquiryForm"
import { SecurityNote } from "./SecurityNote"

type WidgetShellProps = {
  onMinimize: () => void
}

type WidgetMessage = {
  role: ChatbotMessageRole
  content: string
  createdAt: Date
}

const initialMessage = {
  role: "assistant",
  content: "ご相談や案件依頼はこちらです。最終媒体、公開時期、作業時期などを会話で整理します。",
  createdAt: new Date(),
} satisfies WidgetMessage

const noUi = { kind: "none" } satisfies WidgetUi
const networkErrorMessage = "通信に失敗しました。少し時間をおいてもう一度お試しください。"
const inquirySentMessage = "送信しました。担当者からの返信をお待ちください。"

export function WidgetShell({ onMinimize }: WidgetShellProps) {
  const [messages, setMessages] = useState<WidgetMessage[]>([initialMessage])
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [activeUi, setActiveUi] = useState<WidgetUi>(noUi)
  const [submitting, setSubmitting] = useState(false)

  const appendMessage = (message: WidgetMessage) => {
    setMessages((currentMessages) => [...currentMessages, message])
  }

  const handleSubmit = async (text: string) => {
    const createdAt = new Date()
    setMessages((currentMessages) => [
      ...currentMessages,
      { role: "user", content: text, createdAt },
    ])
    setActiveUi(noUi)
    setSubmitting(true)

    try {
      const payload = await submitChatbotMessage({ message: text, conversationId })
      setConversationId(payload.conversationId)
      appendMessage({
        role: payload.assistantMessage.role,
        content: payload.assistantMessage.content,
        createdAt: new Date(payload.assistantMessage.createdAt),
      })
      setActiveUi(payload.ui)
    } catch {
      appendMessage({
        role: "system",
        content: networkErrorMessage,
        createdAt: new Date(),
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleInquirySubmit = async (input: Omit<SubmitInquiryInput, "conversationId">) => {
    try {
      await submitChatbotInquiry({ ...input, conversationId })
      appendMessage({
        role: "assistant",
        content: inquirySentMessage,
        createdAt: new Date(),
      })
      setActiveUi(noUi)
    } catch {
      appendMessage({
        role: "system",
        content: networkErrorMessage,
        createdAt: new Date(),
      })
    }
  }

  return (
    <section
      className="glass-card pointer-events-auto flex h-[min(560px,calc(100dvh-2rem))] w-full max-w-[384px] animate-in fade-in slide-in-from-bottom-2 duration-300 flex-col overflow-hidden rounded-t-[20px] md:rounded-[20px]"
      aria-label="AI 相談窓口"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--glass-border)] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="glass-badge flex h-10 w-10 shrink-0 items-center justify-center">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-hp">AI アシスタント</p>
            <p className="mt-0.5 truncate text-xs text-hp-muted">
              のりかね映像設計室のご相談窓口
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onMinimize}
          className="glass-btn flex h-9 w-9 shrink-0 items-center justify-center hover:shadow-[0_0_24px_rgba(139,127,255,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
          aria-label="最小化"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <SecurityNote defaultOpen={false} />
        <div className="space-y-3" role="log" aria-live="polite">
          {messages.map((message, index) => (
            <ChatMessage
              key={`${message.role}-${message.createdAt.toISOString()}-${index}`}
              role={message.role}
              content={message.content}
              createdAt={message.createdAt}
            />
          ))}
        </div>
        <ActiveWidgetUi ui={activeUi} conversationId={conversationId} onSubmit={handleSubmit} onInquirySubmit={handleInquirySubmit} />
      </div>

      <ChatInput onSubmit={handleSubmit} disabled={submitting} />
    </section>
  )
}

function ActiveWidgetUi({
  ui,
  conversationId,
  onSubmit,
  onInquirySubmit,
}: {
  ui: WidgetUi
  conversationId?: string
  onSubmit: (text: string) => void
  onInquirySubmit: (input: Omit<SubmitInquiryInput, "conversationId">) => void
}) {
  if (ui.kind === "choice-panel") {
    return (
      <ChoicePanel
        choiceSet={ui.choiceSet}
        onSelect={(selectedIds) => onSubmit(`選択: ${selectedIds.join(", ")}`)}
      />
    )
  }

  if (ui.kind === "booking-card") {
    return (
      <ChatbotBookingCard
        conversationId={conversationId}
        candidates={ui.suggestedSlots}
        estimate={ui.jobContext.workflowEstimate}
        defaultProjectTitle={ui.bookingPrefill?.projectTitle}
        defaultContactName={ui.bookingPrefill?.contactName}
        defaultCompanyName={ui.bookingPrefill?.companyName}
        defaultDueDate={ui.bookingPrefill?.dueDate}
        defaultMemo={ui.jobContext.referenceUrls?.join("\n")}
      />
    )
  }

  if (ui.kind === "direct-contact-card") {
    return (
      <DirectContactCard
        reason={ui.reason}
        suggestedMessage={ui.suggestedMessage}
        onSubmitEmail={(email, companyName, personName) =>
          onInquirySubmit({
            name: personName || "未入力",
            email,
            jobType: ui.reason,
            duration: "",
            desiredDeadline: "",
            freeText: [companyName, ui.suggestedMessage].filter(Boolean).join("\n"),
          })
        }
      />
    )
  }

  if (ui.kind === "tier4-inquiry-form") {
    return <InquiryForm onSubmit={onInquirySubmit} />
  }

  return null
}
