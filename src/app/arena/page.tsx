import type { Metadata } from "next";
import { ArenaBoard } from "@/components/arena/ArenaBoard";

const description = "Forecaster rankings for Prediction Rooms: Brier-scored accuracy on verified Panta market outcomes. No trading PnL, no rewards.";

export const metadata: Metadata = {
  title: "Forecasting Arena",
  description,
  openGraph: { title: "Forecasting Arena | Brief Command", description, type: "website", siteName: "Brief Command" },
  twitter: { card: "summary", title: "Forecasting Arena | Brief Command", description },
};

export default function ArenaPage() {
  return <ArenaBoard />;
}
