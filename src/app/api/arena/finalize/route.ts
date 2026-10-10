import { NextRequest } from "next/server";
import { z } from "zod";
import { checkAdminToken } from "@/lib/arena/admin";
import { arenaDeps } from "@/lib/arena/deps";
import { MAX_PENDING_BATCH, finalizeMarket, finalizePending } from "@/lib/arena/finalize";
import { BASE58_PUBKEY_RE } from "@/lib/panta/routes";
import { slugProblem } from "@/lib/rooms/domain";
import { errorResponse, limitRequest, ok, readJson, reject } from "@/lib/rooms/http";

export const dynamic = "force-dynamic";

const Body = z.union([
  z.strictObject({ marketId: z.string().regex(BASE58_PUBKEY_RE, "Invalid market id.") }),
  z.strictObject({ roomSlug: z.string().min(1).max(64) }),
  z.strictObject({ pending: z.literal(true), limit: z.number().int().min(1).max(MAX_PENDING_BATCH).optional() }),
]);

/**
 * POST /api/arena/finalize — PROTECTED (Authorization: Bearer $ROOMS_ADMIN_TOKEN).
 * Body: {marketId} | {roomSlug} | {pending: true, limit?: 1..10}.
 * Verifies resolution from Panta + the on-chain Event and writes immutable
 * scores once. Disabled (503) when the token isn't configured. Outcomes or
 * scores in the body are rejected (strict schema).
 */
export async function POST(req: NextRequest) {
  // Every attempt (authorized or not) is IP rate-limited before the token check.
  const limited = await limitRequest(req, "arenaAuth");
  if (limited) return limited;
  const auth = checkAdminToken(req.headers.get("authorization"));
  if (!auth.ok) {
    return auth.code === "ARENA_ADMIN_UNCONFIGURED"
      ? reject(503, auth.code, "Arena finalization is disabled: ROOMS_ADMIN_TOKEN isn't configured on this server.")
      : reject(401, auth.code, "A valid admin token is required.");
  }
  const read = await readJson(req, "arenaFinalize", 1024);
  if (!read.ok) return read.res;
  const parsed = Body.safeParse(read.body);
  if (!parsed.success) return reject(400, "INVALID_FINALIZE_REQUEST", "Send {marketId}, {roomSlug} or {pending: true}. Outcomes and scores can't be supplied.");
  const deps = arenaDeps();
  try {
    const b = parsed.data;
    if ("pending" in b) return ok({ reports: await finalizePending(deps, b.limit ?? MAX_PENDING_BATCH) });
    let marketId: string;
    if ("roomSlug" in b) {
      const slug = b.roomSlug.toLowerCase();
      const room = slugProblem(slug) ? null : await deps.repo.getRoomBySlug(slug);
      if (!room) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
      marketId = room.marketId;
    } else {
      marketId = b.marketId;
    }
    return ok({ reports: [await finalizeMarket(deps, marketId)] });
  } catch (e) {
    return errorResponse(e);
  }
}
