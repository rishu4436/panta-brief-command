import type { Metadata } from "next";
import { CreateRoomWorkspace } from "@/components/rooms/CreateRoomWorkspace";

export const metadata: Metadata = { title: "Create a Prediction Room" };

export default function CreateRoomPage() {
  return <CreateRoomWorkspace />;
}
