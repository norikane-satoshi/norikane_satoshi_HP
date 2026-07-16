import type { Metadata } from "next";
import { Noto_Serif_JP, Noto_Sans_JP, Inter, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import "@/components/booking/booking-calendar.css";
import "@/components/booking/booking-section.css";
import { ChatbotWidget } from "@/components/chatbot/widget/ChatbotWidget";
import { NavHeader } from "@/components/hp/nav-header";
import { SITE_BRAND_NAME, SITE_OWNER_NAME, SITE_TAGLINE, SITE_TITLE } from "@/lib/site-brand";

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

export const metadata: Metadata = {
  metadataBase: new URL("https://norikane.studio"),
  title: SITE_TITLE,
  description: `${SITE_TAGLINE} ${SITE_BRAND_NAME} のポートフォリオサイト。`,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_TAGLINE,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${notoSerifJP.variable} ${notoSansJP.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NavHeader />
        <main className="flex-1 pt-24 md:pt-28 pb-16">
          {children}
        </main>
        <footer
          className="px-6 py-8 text-center text-sm text-hp-muted"
          style={{ background: "rgba(248, 246, 255, 0.85)", borderTop: "1px solid rgba(255,255,255,0.6)" }}
        >
          <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-center gap-3 md:flex-row md:gap-6">
            <p>&copy; 2026 {SITE_BRAND_NAME} / {SITE_OWNER_NAME}. All rights reserved.</p>
            <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2" aria-label="法務">
              <Link className="underline decoration-dotted underline-offset-4 hover:text-hp" href="/privacy">
                プライバシーポリシー
              </Link>
              <Link className="underline decoration-dotted underline-offset-4 hover:text-hp" href="/terms">
                利用規約
              </Link>
            </nav>
          </div>
        </footer>
        <ChatbotWidget />
      </body>
    </html>
  );
}
