import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { RoomDetail } from "@/components/rooms/RoomDetail";
import { ErrorState } from "@/components/ui/States";
import { marketLabel } from "@/lib/format";
import { getMarketServerSoft } from "@/lib/panta/server";
import { roomPath, slugProblem, type Room } from "@/lib/rooms/domain";
import { getRoomBySlug } from "@/lib/rooms/service";
import { roomRepository, RoomStoreUnavailableError, UNCONFIGURED_MESSAGE } from "@/lib/rooms/store";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

type Lookup = { kind: "found"; room: Room } | { kind: "missing" } | { kind: "unavailable"; message: string };

/** One repository read per request, shared by metadata and the page. */
const lookupRoom = cache(async (rawSlug: string): Promise<Lookup> => {
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug).toLowerCase();
  } catch {
    return { kind: "missing" };
  }
  if (slugProblem(slug)) return { kind: "missing" };
  try {
    const room = await getRoomBySlug(roomRepository(), slug);
    return room && room.status === "active" ? { kind: "found", room } : { kind: "missing" };
  } catch (e) {
    if (e instanceof RoomStoreUnavailableError) {
      return { kind: "unavailable", message: e.reason === "unconfigured" ? UNCONFIGURED_MESSAGE : "Room storage didn't respond. Try again shortly." };
    }
    throw e;
  }
});

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") || h.get("host") || "localhost").split(",")[0].trim();
  const proto = (h.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https")).split(",")[0].trim();
  return `${proto === "http" ? "http" : "https"}://${host}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const found = await lookupRoom(slug);
  if (found.kind !== "found") return { title: found.kind === "missing" ? "Room not found" : "Prediction Room", robots: { index: false } };
  const { room } = found;
  const origin = await siteOrigin();
  const url = `${origin}${roomPath(room.slug)}`;
  const market = await getMarketServerSoft(room.marketId);
  const marketLine = market ? `Market: ${marketLabel(market, { max: 100 })}` : null;
  const description = [room.description || "A Prediction Room on Brief Command.", marketLine].filter(Boolean).join(" · ").slice(0, 200);
  return {
    title: room.title,
    description,
    alternates: { canonical: url },
    ...(room.visibility === "unlisted" ? { robots: { index: false, follow: false } } : {}),
    openGraph: { title: `${room.title} | Brief Command`, description, url, type: "website", siteName: "Brief Command" },
    twitter: { card: "summary", title: `${room.title} | Brief Command`, description },
  };
}

export default async function RoomPage({ params }: Props) {
  const { slug } = await params;
  const found = await lookupRoom(slug);
  if (found.kind === "missing") notFound();
  if (found.kind === "unavailable") {
    return (
      <div className="mx-auto max-w-xl py-10">
        <ErrorState title="Room unavailable" description={found.message} />
      </div>
    );
  }
  const origin = await siteOrigin();
  return <RoomDetail room={found.room} canonicalUrl={`${origin}${roomPath(found.room.slug)}`} />;
}
