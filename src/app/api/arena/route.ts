import { NextRequest } from "next/server";
import { ARENA_PAGE_MAX, arenaPage } from "@/lib/arena/service";
import { roomRepository } from "@/lib/rooms/store";
import { errorResponse, limitRequest, ok } from "@/lib/rooms/http";

export const dynamic = "force-dynamic";

const int = (v: string | null, d: number, min: number, max: number) => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : d;
};

/**
 * GET /api/arena?tier=ranked|provisional&limit&offset — public rankings from
 * the maintained reputation index (no scans). Ranked = at least the minimum
 * number of scored markets; provisional = below it (no rank).
 */
export async function GET(req: NextRequest) {
  const limited = await limitRequest(req, "arenaRead");
  if (limited) return limited;
  const sp = req.nextUrl.searchParams;
  const tier = sp.get("tier") === "provisional" ? "provisional" : "ranked";
  try {
    return ok(await arenaPage(roomRepository(), tier, int(sp.get("limit"), 20, 1, ARENA_PAGE_MAX), int(sp.get("offset"), 0, 0, 100_000)));
  } catch (e) {
    return errorResponse(e);
  }
}
