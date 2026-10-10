import { NextRequest } from "next/server";
import { slugProblem, UpdateRoomInput } from "@/lib/rooms/domain";
import { roomDeps } from "@/lib/rooms/deps";
import { getRoomBySlug, updateRoomDetails } from "@/lib/rooms/service";
import { currentSession, errorResponse, limitRequest, ok, readJson, reject, sameOriginOrReject } from "@/lib/rooms/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

async function slugFrom(ctx: Ctx): Promise<string | null> {
  const { slug } = await ctx.params;
  const s = (slug || "").toLowerCase();
  return slugProblem(s) === null ? s : null;
}

/** GET /api/rooms/:slug — one room (public and unlisted rooms are readable by link). */
export async function GET(req: NextRequest, ctx: Ctx) {
  const limited = await limitRequest(req, "read");
  if (limited) return limited;
  const slug = await slugFrom(ctx);
  if (!slug) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
  try {
    const room = await getRoomBySlug(roomDeps().repo, slug);
    if (!room || room.status !== "active") return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
    return ok({ room });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * PATCH /api/rooms/:slug {title?, description?, visibility?, status?} — creator
 * only (verified session wallet, never a wallet from the body). status
 * "archived" archives, "active" unarchives. marketId and slug are immutable
 * (the strict schema rejects them). To anyone but the creator an archived
 * room doesn't exist (404, same as GET).
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const cross = sameOriginOrReject(req);
  if (cross) return cross;
  const session = currentSession(req);
  if (!session) return reject(401, "WALLET_NOT_VERIFIED", "Verify your wallet first.");
  const slug = await slugFrom(ctx);
  if (!slug) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
  const read = await readJson(req, "update");
  if (!read.ok) return read.res;
  const parsed = UpdateRoomInput.safeParse(read.body);
  if (!parsed.success) return reject(400, "INVALID_ROOM", (parsed.error.issues[0]?.message ?? "Invalid update.").slice(0, 200));
  const deps = roomDeps();
  try {
    const room = await getRoomBySlug(deps.repo, slug);
    if (!room || (room.status !== "active" && room.creatorWallet !== session.wallet)) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
    return ok({ room: await updateRoomDetails(deps, session.wallet, room.roomId, parsed.data) });
  } catch (e) {
    return errorResponse(e);
  }
}
