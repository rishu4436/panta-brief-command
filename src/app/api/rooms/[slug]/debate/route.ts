import { NextRequest } from "next/server";
import { DEBATE_ID_RE, GenerateDebateInput } from "@/lib/debate/domain";
import { debateDeps } from "@/lib/debate/deps";
import { debateErrorResponse } from "@/lib/debate/http";
import { generateDebate, readDebateView } from "@/lib/debate/service";
import { slugProblem } from "@/lib/rooms/domain";
import { DEBATE_RATE, currentSession, limitRequest, ok, readJson, reject, sameOriginOrReject } from "@/lib/rooms/http";
import { clientIp } from "@/lib/rate-limit";
import { limitShared } from "@/lib/shared-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

async function slugFrom(ctx: Ctx): Promise<string | null> {
  const { slug } = await ctx.params;
  const s = (slug || "").toLowerCase();
  return slugProblem(s) === null ? s : null;
}

/**
 * GET /api/rooms/:slug/debate[?debate=<id>] — public, read-only. Never
 * generates or calls the model. Returns the room's latest (or the requested,
 * retained) debate with its freshness, its challenges, the market state and
 * whether generation is possible. Archived / missing rooms → 404.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const limited = await limitRequest(req, "debateRead");
  if (limited) return limited;
  const slug = await slugFrom(ctx);
  if (!slug) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
  const raw = req.nextUrl.searchParams.get("debate");
  const debateId = raw && DEBATE_ID_RE.test(raw) ? raw : null;
  const deps = debateDeps();
  try {
    const room = await deps.repo.getRoomBySlug(slug);
    if (!room || room.status !== "active") return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
    const view = await readDebateView(deps, room, { debateId });
    const session = currentSession(req);
    return ok({ roomId: room.roomId, viewer: { verified: Boolean(session) }, ...view, requestedDebateMissing: view.requestedDebateMissing || Boolean(raw && !debateId) });
  } catch (e) {
    return debateErrorResponse(e);
  }
}

/**
 * POST /api/rooms/:slug/debate {idempotencyKey} — generate (or reuse) the
 * room's debate. Verified wallet session, same origin, rate limited per IP
 * and per wallet. See lib/debate/service.ts for who may generate and when.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const cross = sameOriginOrReject(req);
  if (cross) return cross;
  const session = currentSession(req);
  if (!session) return reject(401, "WALLET_NOT_VERIFIED", "Verify your wallet to generate a debate.");
  const slug = await slugFrom(ctx);
  if (!slug) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
  const read = await readJson(req, "debateGenerate", 1024);
  if (!read.ok) return read.res;
  const parsed = GenerateDebateInput.safeParse(read.body);
  if (!parsed.success) return reject(400, "INVALID_REQUEST", "Send {idempotencyKey}.");

  const deps = debateDeps();
  try {
    const room = await deps.repo.getRoomBySlug(slug);
    if (!room || room.status !== "active") return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
    // Replays don't count against the hourly limits.
    const prior = await deps.repo.findDebateByIdempotencyKey(room.roomId, parsed.data.idempotencyKey);
    if (!prior) {
      const w = await limitShared(`debate-gen-wallet:${session.wallet}`, DEBATE_RATE.generateWallet.limit, DEBATE_RATE.generateWallet.windowMs);
      if (!w.ok) return reject(429, "RATE_LIMITED", "You've generated several debates recently. Try again later.", { "Retry-After": String(w.retryAfterSec) });
      const ip = await limitShared(`debate-gen-ip:${clientIp(req.headers)}`, DEBATE_RATE.generateIp.limit, DEBATE_RATE.generateIp.windowMs);
      if (!ip.ok) return reject(429, "RATE_LIMITED", "Too many debate requests from this network. Try again later.", { "Retry-After": String(ip.retryAfterSec) });
    }
    const res = await generateDebate(deps, room, parsed.data.idempotencyKey);
    return ok(res, res.status === "created" ? 201 : 200);
  } catch (e) {
    return debateErrorResponse(e);
  }
}
