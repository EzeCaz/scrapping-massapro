import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Scrapling Web Scraper - Extract Contact Data from the Web",
  description: "Extract business data, emails, phone numbers, and social profiles from Google Maps and the web using Scrapling.",
  keywords: ["web scraper", "Scrapling", "Google Maps scraper", "contact extraction", "email finder", "phone finder"],
  authors: [{ name: "Scrapling Web Scraper" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Scrapling Web Scraper",
    description: "Extract contact data from Google Maps & the web",
    url: "https://chat.z.ai",
    siteName: "Scrapling Web Scraper",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Scrapling Web Scraper",
    description: "Extract contact data from Google Maps & the web",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
