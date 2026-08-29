import type { Metadata } from "next";
import { Noto_Serif_JP, Noto_Sans_JP, Inter, Geist_Mono } from "next/font/google";
import {NextIntlClientProvider, hasLocale} from "next-intl";
import {getLocale, getMessages, getTranslations} from "next-intl/server";
import "./globals.css";
import "@/components/booking/booking-calendar.css";
import "@/components/booking/booking-section.css";
import { ChatbotWidget } from "@/components/chatbot/widget/ChatbotWidget";
import { NavHeader } from "@/components/hp/nav-header";
import {Link} from "@/i18n/navigation";
import {localeAlternates} from "@/i18n/metadata";
import {routing} from "@/i18n/routing";

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

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestedLocale = await getLocale()
  const locale = hasLocale(routing.locales, requestedLocale)
    ? requestedLocale
    : routing.defaultLocale
  const t = await getTranslations({locale, namespace: "Metadata"})

  return {
    metadataBase: new URL("https://norikane.studio"),
    title: t("title"),
    description: t("description"),
    alternates: localeAlternates("/", locale),
    openGraph: {
      title: t("title"),
      description: t("description"),
      type: "website",
      locale: locale === "ja" ? "ja_JP" : "en_US",
      alternateLocale: locale === "ja" ? ["en_US"] : ["ja_JP"],
    },
    twitter: {
      card: "summary_large_image",
    },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestedLocale = await getLocale()
  const locale = hasLocale(routing.locales, requestedLocale)
    ? requestedLocale
    : routing.defaultLocale
  const messages = await getMessages()
  const footer = await getTranslations({locale, namespace: "Footer"})

  return (
    <html
      lang={locale}
      className={`${notoSerifJP.variable} ${notoSansJP.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider messages={messages}>
          <NavHeader />
          <main className="flex-1 pt-24 md:pt-28 pb-16">
            {children}
          </main>
          <footer
            className="px-6 py-8 text-center text-sm text-hp-muted"
            style={{ background: "rgba(248, 246, 255, 0.85)", borderTop: "1px solid rgba(255,255,255,0.6)" }}
          >
            <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-center gap-3 md:flex-row md:gap-6">
              <p>{footer("copyright")}</p>
              <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2" aria-label={footer("legalLabel")}>
                <Link className="underline decoration-dotted underline-offset-4 hover:text-hp" href="/privacy">
                  {footer("privacy")}
                </Link>
                <Link className="underline decoration-dotted underline-offset-4 hover:text-hp" href="/terms">
                  {footer("terms")}
                </Link>
              </nav>
            </div>
          </footer>
          <ChatbotWidget locale={locale} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
