import { NextRequest } from "next/server";
import { slugProblem } from "@/lib/rooms/domain";
import { errorResponse, ok, reject } from "@/lib/rooms/http";
import { studioAuth, studioDeps } from "@/lib/studio/http";
import { getStudioRoom } from "@/lib/studio/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET /api/studio/rooms/:slug — analytics + distribution links for one room.
 * Missing and not-yours answer the same 404, so other creators' rooms
 * (including archived and unlisted ones) can't be probed.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = await studioAuth(req);
  if (!auth.ok) return auth.res;
  const slug = ((await ctx.params).slug || "").toLowerCase();
  if (slugProblem(slug)) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
  try {
    const room = await getStudioRoom(studioDeps(), auth.wallet, slug);
    if (!room) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
    return ok(room);
  } catch (e) {
    return errorResponse(e);
  }
}
