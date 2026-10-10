import type { Metadata } from "next";
import { ArenaBoard } from "@/components/arena/ArenaBoard";
import { CommunityUnavailablePage } from "@/components/community/CommunityUnavailable";
import { communityAvailability } from "@/lib/rooms/availability";

const description = "Forecaster rankings for Prediction Rooms: Brier-scored accuracy on verified Panta market outcomes. No trading PnL, no rewards.";

export const metadata: Metadata = {
  title: "Forecasting Arena",
  description,
  openGraph: { title: "Forecasting Arena | Brief Command", description, type: "website", siteName: "Brief Command" },
  twitter: { card: "summary", title: "Forecasting Arena | Brief Command", description },
};

export default async function ArenaPage() {
  const { available, readOnly } = await communityAvailability();
  if (!available) {
    return (
      <CommunityUnavailablePage
        feature="arena"
        readOnly={readOnly}
        eyebrow="Forecasting Arena"
        title="Forecaster rankings"
        description="Accuracy of community forecasts in Prediction Rooms, scored with the Brier rule only after a market's outcome is verified."
      />
    );
  }
  return <ArenaBoard />;
}
