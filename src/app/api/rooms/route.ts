import { NextRequest } from "next/server";
import { CreateRoomInput, roomPath } from "@/lib/rooms/domain";
import { decodeWallet } from "@/lib/rooms/auth";
import { roomDeps } from "@/lib/rooms/deps";
import { createRoom, listCreatorRooms, listPublicRooms } from "@/lib/rooms/service";
import { currentSession, errorResponse, limitRequest, ok, readJson, reject, sameOriginOrReject, requireSession } from "@/lib/rooms/http";

export const dynamic = "force-dynamic";

const MAX_LIST = 50;

/**
 * GET /api/rooms[?creator=<wallet>][&limit=n] — public rooms, newest first.
 * With ?creator= equal to the signed-in wallet, that wallet's unlisted rooms
 * are included too. Public; no wallet needed.
 */
export async function GET(req: NextRequest) {
  const limited = await limitRequest(req, "read");
  if (limited) return limited;
  const sp = req.nextUrl.searchParams;
  const rawLimit = Number(sp.get("limit") || MAX_LIST);
  const limit = Number.isInteger(rawLimit) ? Math.min(MAX_LIST, Math.max(1, rawLimit)) : MAX_LIST;
  const creator = sp.get("creator");
  const { repo } = roomDeps();
  try {
    if (creator !== null) {
      if (!decodeWallet(creator)) return reject(400, "INVALID_WALLET", "Not a valid Solana wallet address.");
      const own = (await currentSession(req))?.wallet === creator.trim();
      const rooms = await listCreatorRooms(repo, creator.trim(), { limit, includeUnlisted: own });
      return ok({ rooms, store: repo.kind });
    }
    return ok({ rooms: await listPublicRooms(repo, limit), store: repo.kind });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/rooms — create a room. Creator = the verified wallet in the
 * HttpOnly session; the body cannot name a creator (unknown keys → 400).
 */
export async function POST(req: NextRequest) {
  const cross = sameOriginOrReject(req);
  if (cross) return cross;
  const auth = await requireSession(req, { message: "Verify your wallet before creating a room." });
  if (!auth.ok) return auth.res;
  const session = auth.session;
  const read = await readJson(req, "create");
  if (!read.ok) return read.res;
  const parsed = CreateRoomInput.safeParse(read.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path?.[0];
    return reject(400, "INVALID_ROOM", `${field ? `${String(field)}: ` : ""}${issue?.message ?? "Invalid room."}`.slice(0, 200));
  }
  try {
    const res = await createRoom(roomDeps(), session.wallet, parsed.data);
    return ok({ ...res, url: roomPath(res.room.slug) }, res.status === "created" ? 201 : 200);
  } catch (e) {
    return errorResponse(e);
  }
}
