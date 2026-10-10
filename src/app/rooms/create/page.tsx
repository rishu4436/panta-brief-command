import type { Metadata } from "next";
import { CommunityUnavailablePage } from "@/components/community/CommunityUnavailable";
import { CreateRoomWorkspace } from "@/components/rooms/CreateRoomWorkspace";
import { communityAvailability } from "@/lib/rooms/availability";

export const metadata: Metadata = { title: "Create a Prediction Room" };

export default async function CreateRoomPage() {
  const { available, readOnly } = await communityAvailability();
  if (!available) {
    return (
      <CommunityUnavailablePage
        feature="create-room"
        readOnly={readOnly}
        eyebrow="Community"
        title="Create a Prediction Room"
        description="Pick a live Panta market, name the room and share the link."
      />
    );
  }
  return <CreateRoomWorkspace />;
}
