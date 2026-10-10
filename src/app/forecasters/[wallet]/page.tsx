import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ForecasterProfile } from "@/components/arena/ForecasterProfile";
import { reputationView, formatScoreC } from "@/lib/arena/scoring";
import { shortAddr } from "@/lib/format";
import { decodeWallet } from "@/lib/rooms/auth";
import { roomRepository } from "@/lib/rooms/store";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ wallet: string }> };

function walletParam(raw: string): string | null {
  let w: string;
  try {
    w = decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
  return decodeWallet(w) ? w : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const wallet = walletParam((await params).wallet);
  if (!wallet) return { title: "Forecaster not found", robots: { index: false } };
  let summary = "No verified scored markets yet.";
  try {
    const rep = await roomRepository().getReputation(wallet);
    if (rep) {
      const v = reputationView(rep);
      summary = `${v.scoredCount} verified scored market${v.scoredCount === 1 ? "" : "s"} · avg Brier score ${formatScoreC(v.avgDisplayC)}${v.ranked ? "" : " · provisional"}.`;
    }
  } catch {
    /* metadata stays generic when storage is unavailable */
  }
  const title = `Forecaster ${shortAddr(wallet, 4)}`;
  const description = `Forecasting record on Brief Command Prediction Rooms. ${summary}`;
  return {
    title,
    description,
    openGraph: { title: `${title} | Brief Command`, description, type: "profile", siteName: "Brief Command" },
    twitter: { card: "summary", title: `${title} | Brief Command`, description },
  };
}

export default async function ForecasterPage({ params }: Props) {
  const wallet = walletParam((await params).wallet);
  if (!wallet) notFound();
  return <ForecasterProfile wallet={wallet} />;
}
