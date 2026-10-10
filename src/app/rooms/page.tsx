import type { Metadata } from "next";
import { CommunityUnavailablePage } from "@/components/community/CommunityUnavailable";
import { RoomsDirectory } from "@/components/rooms/RoomsDirectory";
import { communityAvailability } from "@/lib/rooms/availability";

export const metadata: Metadata = {
  title: "Prediction Rooms",
  description: "Wallet-owned community rooms, each built around one live Panta prediction market on Solana.",
  openGraph: {
    title: "Prediction Rooms | Brief Command",
    description: "Wallet-owned community rooms, each built around one live Panta prediction market on Solana.",
    type: "website",
    siteName: "Brief Command",
  },
};

export default async function RoomsPage() {
  const { available, readOnly } = await communityAvailability();
  if (!available) {
    return (
      <CommunityUnavailablePage
        feature="rooms"
        readOnly={readOnly}
        eyebrow="Community"
        title="Prediction Rooms"
        description="Rooms are wallet-owned community spaces, each built around one live Panta market."
      />
    );
  }
  return <RoomsDirectory />;
}
