import { NextRequest } from "next/server";
import { forecastDeps } from "@/lib/forecasts/deps";
import { walletForecast } from "@/lib/forecasts/service";
import { slugProblem } from "@/lib/rooms/domain";
import { currentSession, errorResponse, limitRequest, ok, reject } from "@/lib/rooms/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET /api/rooms/:slug/forecasts/me — the verified wallet's current forecast
 * and its full revision history (newest first, bounded). Without a session:
 * { wallet: null }.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const limited = await limitRequest(req, "read");
  if (limited) return limited;
  const { slug: raw } = await ctx.params;
  const slug = (raw || "").toLowerCase();
  if (slugProblem(slug)) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
  const session = currentSession(req);
  const { repo } = forecastDeps();
  try {
    const room = await repo.getRoomBySlug(slug);
    if (!room || room.status !== "active") return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
    if (!session) return ok({ wallet: null, current: null, history: [] });
    return ok({ wallet: session.wallet, ...(await walletForecast(repo, room.roomId, session.wallet)) });
  } catch (e) {
    return errorResponse(e);
  }
}
