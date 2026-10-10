import { NextRequest } from "next/server";
import { ARENA_PAGE_MAX, forecasterProfile } from "@/lib/arena/service";
import { decodeWallet } from "@/lib/rooms/auth";
import { roomRepository } from "@/lib/rooms/store";
import { errorResponse, limitRequest, ok, reject } from "@/lib/rooms/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ wallet: string }> };

/** GET /api/forecasters/:wallet — public profile (reputation, scores, rooms, revisions). No auth data. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const limited = await limitRequest(req, "arenaRead");
  if (limited) return limited;
  const { wallet: raw } = await ctx.params;
  const wallet = (raw || "").trim();
  if (!decodeWallet(wallet)) return reject(400, "INVALID_WALLET", "That isn't a Solana wallet address.");
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(ARENA_PAGE_MAX, Math.max(1, Number.parseInt(sp.get("limit") || "20", 10) || 20));
  const offset = Math.min(100_000, Math.max(0, Number.parseInt(sp.get("offset") || "0", 10) || 0));
  try {
    return ok(await forecasterProfile(roomRepository(), wallet, limit, offset));
  } catch (e) {
    return errorResponse(e);
  }
}
