"use client"

import { MessageCircle } from "lucide-react"

const CHATBOT_OPEN_EVENT = "hp-chatbot:open"
const CONTACT_HASH = "#contact"

export function ContactChatbotButton() {
  const openChatbot = () => {
    if (window.location.hash !== CONTACT_HASH) {
      window.history.pushState(null, "", CONTACT_HASH)
    }
    window.dispatchEvent(new Event(CHATBOT_OPEN_EVENT))
  }

  return (
    <button
      type="button"
      onClick={openChatbot}
      className="glass-btn inline-flex min-h-12 items-center justify-center gap-2 px-5 py-3 text-sm font-semibold"
    >
      <MessageCircle className="h-4 w-4" strokeWidth={1.8} />
      AI 相談窓口を開く
    </button>
  )
}
