import type { Metadata } from "next";
import { CommunityUnavailablePage } from "@/components/community/CommunityUnavailable";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";
import { communityAvailability } from "@/lib/rooms/availability";

export const metadata: Metadata = {
  title: "Creator Studio",
  description: "Manage your Prediction Rooms and see how people forecast in them.",
  robots: { index: false, follow: false },
};

export default async function StudioPage() {
  const { available, readOnly } = await communityAvailability();
  if (!available) {
    return (
      <CommunityUnavailablePage
        feature="studio"
        readOnly={readOnly}
        eyebrow="Creators"
        title="Creator Studio"
        description="Your rooms, how people forecast in them, and how they find them."
      />
    );
  }
  return <StudioWorkspace />;
}
