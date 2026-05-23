import type { Metadata } from "next";
import { Noto_Sans_JP, Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import "@/components/booking/booking-calendar.css";
import "@/components/booking/booking-section.css";
import { ChatbotShell } from "@/components/hp/chatbot-shell";
import { NavHeader } from "@/components/hp/nav-header";
import { SITE_BRAND_NAME, SITE_OWNER_NAME, SITE_TAGLINE, SITE_TITLE } from "@/lib/site-brand";

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "600", "700"],
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
      className={`${notoSansJP.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NavHeader />
        <main className="flex-1 pt-24 md:pt-28 pb-16">
          {children}
        </main>
        <footer
          className="text-center py-8 text-sm text-hp-muted"
          style={{ background: "rgba(248, 246, 255, 0.85)", borderTop: "1px solid rgba(255,255,255,0.6)" }}
        >
          <p>&copy; 2026 {SITE_BRAND_NAME} / {SITE_OWNER_NAME}. All rights reserved.</p>
        </footer>
        <ChatbotShell />
      </body>
    </html>
  );
}
