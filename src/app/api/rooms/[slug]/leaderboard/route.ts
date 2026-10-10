import { NextRequest } from "next/server";
import { ARENA_PAGE_MAX, roomLeaderboard } from "@/lib/arena/service";
import { slugProblem } from "@/lib/rooms/domain";
import { roomRepository } from "@/lib/rooms/store";
import { errorResponse, limitRequest, ok, reject } from "@/lib/rooms/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET /api/rooms/:slug/leaderboard — before a verified finalization: "in
 * progress" + pending forecasts (no outcome, no ranking); after: the room's
 * immutable scores ranked by Brier loss (best first); blocked shown as such.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const limited = await limitRequest(req, "read");
  if (limited) return limited;
  const { slug: raw } = await ctx.params;
  const slug = (raw || "").toLowerCase();
  if (slugProblem(slug)) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(ARENA_PAGE_MAX, Math.max(1, Number.parseInt(sp.get("limit") || "20", 10) || 20));
  const offset = Math.min(100_000, Math.max(0, Number.parseInt(sp.get("offset") || "0", 10) || 0));
  try {
    const repo = roomRepository();
    const room = await repo.getRoomBySlug(slug);
    if (!room || room.status !== "active") return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
    return ok({ roomId: room.roomId, marketId: room.marketId, ...(await roomLeaderboard(repo, room, limit, offset)) });
  } catch (e) {
    return errorResponse(e);
  }
}
