import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ClientLayout } from "@/components/ClientLayout";
import { Toaster } from "sonner";
import Script from "next/script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Octofleet",
  description: "Open-source endpoint management for Windows & Linux fleets",
  icons: {
    icon: "/octofleet-logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950`}
      >
        {/* Runtime API URL (BROWSER_API_URL), must load before lib/api-config.ts runs */}
        <Script src="/runtime-config.js" strategy="beforeInteractive" />
        <ClientLayout>{children}</ClientLayout>
        <Toaster position="top-right" richColors closeButton theme="dark" />
      </body>
    </html>
  );
}
