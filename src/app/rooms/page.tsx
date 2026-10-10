import type { Metadata } from "next";
import { RoomsDirectory } from "@/components/rooms/RoomsDirectory";

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

export default function RoomsPage() {
  return <RoomsDirectory />;
}
