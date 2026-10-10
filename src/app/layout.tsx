import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { Providers } from "@/components/Providers";
import { AppShell } from "@/components/AppShell";
import { isReadOnlyDeployment } from "@/lib/deploy-env";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
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
    "Brief Command — an AI-native prediction-market desk on Panta API + Solana. Discover markets, read evidence-based briefs, execute with your wallet, and track positions.",
  openGraph: {
    title: "Brief Command",
    description:
      "Solana prediction desk powered by Panta — intel, signal-based market briefs, primary buys.",
    siteName: "Brief Command",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Brief Command",
    description:
      "Solana prediction desk powered by Panta — intel, signal-based market briefs, primary buys.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased">
        {isReadOnlyDeployment() && (
          <div role="status" data-testid="preview-read-only" className="bg-amber-500/15 px-4 py-1.5 text-center text-xs text-amber-200">
            Preview is read-only: trading, claims and market creation are disabled.
          </div>
        )}
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
