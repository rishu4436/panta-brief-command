import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RoomStudio } from "@/components/studio/RoomStudio";
import { slugProblem } from "@/lib/rooms/domain";

export const metadata: Metadata = { title: "Room · Creator Studio", robots: { index: false, follow: false } };

type Props = { params: Promise<{ slug: string }> };

/** Client-rendered: ownership is checked by /api/studio/rooms/:slug against the session wallet. */
export default async function StudioRoomPage({ params }: Props) {
  const { slug } = await params;
  let s: string;
  try {
    s = decodeURIComponent(slug).toLowerCase();
  } catch {
    notFound();
  }
  if (slugProblem(s)) notFound();
  return <RoomStudio slug={s} />;
}
