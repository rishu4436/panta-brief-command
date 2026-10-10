import { NextRequest } from "next/server";
import { DEFAULT_EMBED_OPTIONS, EMBED_LAYOUTS, EMBED_THEMES } from "@/lib/embed/options";
import { appOrigin } from "@/lib/embed/origin";
import { embedPath, roomUrl } from "@/lib/embed/snippet";
import { slugProblem } from "@/lib/rooms/domain";
import { roomRepository } from "@/lib/rooms/store";
import { currentSession, errorResponse, limitRequest, ok, reject } from "@/lib/rooms/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET /api/rooms/:slug/embed — CREATOR ONLY: embed settings for the room's
 * creator tools (canonical origin from configuration, the allowlisted options
 * and the room/embed paths). The session wallet (HttpOnly, server-verified)
 * must equal the room's creatorWallet: no session → 401, another wallet → 403.
 * Read-only; the snippet itself isn't secret, the management view is.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const limited = await limitRequest(req, "read");
  if (limited) return limited;
  const slug = ((await ctx.params).slug || "").toLowerCase();
  if (slugProblem(slug)) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
  try {
    const room = await roomRepository().getRoomBySlug(slug);
    if (!room || room.status !== "active") return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
    const session = currentSession(req);
    if (!session) return reject(401, "ROOM_AUTH_REQUIRED", "Verify your wallet to manage this room.");
    if (session.wallet !== room.creatorWallet) return reject(403, "ROOM_CREATOR_ONLY", "Only the room's creator can manage its embeds.");
    const origin = appOrigin();
    return ok({
      slug: room.slug,
      title: room.title,
      visibility: room.visibility,
      origin,
      roomUrl: roomUrl(origin, room.slug),
      embedPath: embedPath(room.slug),
      defaults: DEFAULT_EMBED_OPTIONS,
      allowed: { theme: EMBED_THEMES, layout: EMBED_LAYOUTS, dist: [true, false], market: [true, false] },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
