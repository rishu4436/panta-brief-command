import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import { Shell } from "@/components/Shell";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Brief Command",
    template: "%s | Brief Command",
  },
  description:
    "Brief Command — Solana prediction desk powered by Panta. Market intel, AI briefs, primary buys, and book claims.",
  openGraph: {
    title: "Brief Command",
    description:
      "Solana prediction desk powered by Panta — intel, AI briefs, primary buys.",
    siteName: "Brief Command",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Brief Command",
    description:
      "Solana prediction desk powered by Panta — intel, AI briefs, primary buys.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased">
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
