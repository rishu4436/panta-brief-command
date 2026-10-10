import type { Metadata } from "next";
import { Geist_Mono, Instrument_Serif, Inter } from "next/font/google";
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

// Editorial accent face for marketing headlines; self-hosted by next/font, so
// the CSP needs no new font host.
const editorial = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-editorial",
  display: "swap",
});

const DESCRIPTION =
  "A prediction-market platform for intelligence, forecasting, community and execution. Discover live Panta markets on Solana, make free community forecasts in Prediction Rooms, challenge ideas with evidence, and trade through your own wallet.";
const SOCIAL =
  "Read the market, test your thesis, bring others in. Live Panta markets, free community forecasting, evidence-first research and wallet-controlled execution on Solana.";

export const metadata: Metadata = {
  title: {
    default: "Brief Command — Prediction markets, forecasting and community",
    template: "%s | Brief Command",
  },
  description: DESCRIPTION,
  applicationName: "Brief Command",
  openGraph: {
    title: "Brief Command — Read the market. Test your thesis. Bring others in.",
    description: SOCIAL,
    siteName: "Brief Command",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Brief Command — Read the market. Test your thesis. Bring others in.",
    description: SOCIAL,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} ${editorial.variable}`}>
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
