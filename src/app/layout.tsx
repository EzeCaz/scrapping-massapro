import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Scrapling Web Scraper - Extract Contact Data from the Web",
  description: "Extract business data, emails, phone numbers, and social profiles from Google Maps and the web using Scrapling.",
  keywords: ["web scraper", "Scrapling", "Google Maps scraper", "contact extraction", "email finder", "phone finder"],
  authors: [{ name: "Scrapling Web Scraper" }],
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
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
