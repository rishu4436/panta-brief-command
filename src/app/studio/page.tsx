import type { Metadata } from "next";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";

export const metadata: Metadata = {
  title: "Creator Studio",
  description: "Manage your Prediction Rooms and see how people forecast in them.",
  robots: { index: false, follow: false },
};

export default function StudioPage() {
  return <StudioWorkspace />;
}
