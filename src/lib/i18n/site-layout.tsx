import type { Metadata } from "next";
import { Instrument_Serif, Noto_Serif_JP, Noto_Sans_JP, Inter, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "@/app/globals.css";
import "@/components/booking/booking-calendar.css";
import "@/components/booking/booking-section.css";
import { ChatbotWidget } from "@/components/chatbot/widget/ChatbotWidget";
import { NavHeader } from "@/components/hp/nav-header";
import { SITE_BRAND_NAME, SITE_COMPANY_NAME, SITE_TAGLINE, SITE_TITLE, SITE_URL } from "@/lib/site-brand";
import { LanguageLinks, TranslationProvider } from "@/lib/i18n/client";
import type { Language } from "@/lib/i18n/locales";
import type { Dictionary } from "@/lib/i18n/tree";
import { translateTree } from "@/lib/i18n/tree";

const notoSerifJP = Noto_Serif_JP({
  subsets: ["latin"],
  variable: "--font-mincho",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-gothic",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "600", "700"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-latin-display",
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_TAGLINE,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_TAGLINE,
    type: "website",
    siteName: SITE_BRAND_NAME,
    locale: "ja_JP",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function SiteLayout({ children, locale = 'ja', dictionary = {}, languagePath }: {
  children: React.ReactNode; locale?: Language; dictionary?: Dictionary; languagePath?: string;
}) {
  return (
    <html
      lang={locale}
      className={`${notoSerifJP.variable} ${notoSansJP.variable} ${inter.variable} ${instrumentSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TranslationProvider value={{ locale: locale, dictionary }}>
        <NavHeader />
        <main className="flex-1 pt-24 md:pt-28 pb-16">
          {children}
        </main>
        {translateTree(<footer
          className="px-6 py-8 text-center text-sm text-hp-muted"
          style={{ background: "var(--hp-footer-bg)", borderTop: "1px solid var(--hp-footer-border)" }}
        >
          <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-center gap-3 md:flex-row md:gap-6">
            <p>&copy; 2026 {SITE_COMPANY_NAME}. All rights reserved.</p>
            <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2" aria-label="法務">
              <Link className="underline decoration-dotted underline-offset-4 hover:text-hp" href="/privacy">
                プライバシーポリシー
              </Link>
              <Link className="underline decoration-dotted underline-offset-4 hover:text-hp" href="/terms">
                利用規約
              </Link>
            </nav>
          </div>
          <LanguageLinks pathname={languagePath} />
        </footer>, dictionary, locale)}
        </TranslationProvider>
        <ChatbotWidget />
      </body>
    </html>
  );
}
