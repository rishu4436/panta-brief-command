import { NextRequest, NextResponse } from "next/server";
import { slugProblem } from "@/lib/rooms/domain";
import { readJson, reject, requestHost, sameOriginOrReject } from "@/lib/rooms/http";
import { roomRepository } from "@/lib/rooms/store";
import { RoomEventInput } from "@/lib/studio/domain";
import { recordRoomView, skipReason } from "@/lib/studio/events";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

const EVENT_BODY_MAX_BYTES = 512;

/** 204 for every accepted-or-ignored beacon: the client learns nothing about counting or the room. */
const done = () => new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });

/**
 * POST /api/rooms/:slug/events — same-origin room view beacon (navigator.sendBeacon).
 * Anonymous: no cookie or session is read, nothing is set. Validated body
 * (schemaVersion, event, ref, campaign, referrer host); server timestamp;
 * only active rooms count. Bots, prefetches and DNT/GPC are ignored.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const cross = sameOriginOrReject(req);
  if (cross) return cross;
  const read = await readJson(req, "events", EVENT_BODY_MAX_BYTES);
  if (!read.ok) return read.res;
  const parsed = RoomEventInput.safeParse(read.body);
  if (!parsed.success) return reject(400, "INVALID_EVENT", "Invalid event.");
  if (skipReason(req.headers)) return done();
  const slug = ((await ctx.params).slug || "").toLowerCase();
  if (slugProblem(slug)) return done();
  try {
    const repo = roomRepository();
    const room = await repo.getRoomBySlug(slug);
    if (!room || room.status !== "active") return done();
    await recordRoomView(repo, room, parsed.data, req.headers, Date.now(), requestHost(req));
  } catch {
    // Analytics must never surface storage errors to visitors.
  }
  return done();
}
