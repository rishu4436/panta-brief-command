import { NextRequest } from "next/server";
import { forecastDeps } from "@/lib/forecasts/deps";
import { walletForecast } from "@/lib/forecasts/service";
import { slugProblem } from "@/lib/rooms/domain";
import { resolveSession, errorResponse, limitRequest, ok, reject } from "@/lib/rooms/http";

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
  const check = await resolveSession(req);
  if (check.unavailable) return reject(503, "SESSION_STORE_UNAVAILABLE", "Sign-in couldn't be confirmed right now. Try again.");
  const session = check.session;
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
