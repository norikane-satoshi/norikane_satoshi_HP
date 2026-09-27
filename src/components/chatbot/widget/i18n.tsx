"use client"

import {createContext, useContext, type ReactNode} from "react"
import {getLocalizedCopy} from "@/i18n/copy"

const ChatbotLocaleContext = createContext<"ja" | "en">("ja")

export function ChatbotLocaleProvider({locale, children}: {locale: "ja" | "en"; children: ReactNode}) {
  return <ChatbotLocaleContext.Provider value={locale}>{children}</ChatbotLocaleContext.Provider>
}

export function useChatbotLocale() {
  return useContext(ChatbotLocaleContext)
}

export function useChatbotCopy() {
  return getLocalizedCopy(useChatbotLocale(), "Chatbot")
}
