import { NextRequest } from "next/server";
import { ChallengeClaimInput, DEBATE_LIMITS } from "@/lib/debate/domain";
import { debateDeps } from "@/lib/debate/deps";
import { debateErrorResponse } from "@/lib/debate/http";
import { challengeClaim, cleanChallengeText } from "@/lib/debate/service";
import { CLIENT_IDENTITY_KEYS } from "@/lib/forecasts/domain";
import { slugProblem } from "@/lib/rooms/domain";
import { DEBATE_RATE, currentSession, ok, readJson, reject, sameOriginOrReject } from "@/lib/rooms/http";
import { clientIp } from "@/lib/rate-limit";
import { limitShared } from "@/lib/shared-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * POST /api/rooms/:slug/debate/challenges {debateId, claimId, text, sourceUrl?, idempotencyKey}
 * Challenger = the verified wallet in the HttpOnly session (a body naming a
 * wallet is rejected). Only a claim in the room's latest debate, while the
 * market is unresolved and the room active. The answer cites the debate's
 * evidence (or the submitted link) or says the evidence is insufficient.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const cross = sameOriginOrReject(req);
  if (cross) return cross;
  const session = currentSession(req);
  if (!session) return reject(401, "WALLET_NOT_VERIFIED", "Verify your wallet to challenge a claim.");
  const { slug: rawSlug } = await ctx.params;
  const slug = (rawSlug || "").toLowerCase();
  if (slugProblem(slug) !== null) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
  const read = await readJson(req, "debateChallenge", 4 * 1024);
  if (!read.ok) return read.res;
  const body = read.body;
  if (body && typeof body === "object" && CLIENT_IDENTITY_KEYS.some((k) => Object.prototype.hasOwnProperty.call(body, k))) {
    return reject(400, "CLIENT_WALLET_REJECTED", "The challenging wallet comes from your verified sign-in, not the request.");
  }
  const parsed = ChallengeClaimInput.safeParse(body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path?.[0];
    return reject(400, "INVALID_CHALLENGE", `${field ? `${String(field)}: ` : ""}${parsed.error.issues[0]?.message ?? "Invalid challenge."}`.slice(0, 200));
  }
  const text = cleanChallengeText(parsed.data.text);
  if (text.length < DEBATE_LIMITS.challengeMin || text.length > DEBATE_LIMITS.challengeText) {
    return reject(400, "INVALID_CHALLENGE", `Write ${DEBATE_LIMITS.challengeMin}–${DEBATE_LIMITS.challengeText} characters.`);
  }
  const sourceUrl = parsed.data.sourceUrl ? parsed.data.sourceUrl : null;
  if (sourceUrl && !/^https:\/\//i.test(sourceUrl)) return reject(400, "INVALID_CHALLENGE", "sourceUrl: only https links are accepted.");

  const deps = debateDeps();
  try {
    const room = await deps.repo.getRoomBySlug(slug);
    if (!room || room.status !== "active") return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
    const prior = await deps.repo.findChallengeByIdempotencyKey(room.roomId, session.wallet, parsed.data.idempotencyKey);
    if (!prior) {
      const w = await limitShared(`debate-ch-wallet:${session.wallet}`, DEBATE_RATE.challengeWallet.limit, DEBATE_RATE.challengeWallet.windowMs);
      if (!w.ok) return reject(429, "RATE_LIMITED", "You've sent several challenges recently. Wait a few minutes.", { "Retry-After": String(w.retryAfterSec) });
      const ip = await limitShared(`debate-ch-ip:${clientIp(req.headers)}`, DEBATE_RATE.challengeIp.limit, DEBATE_RATE.challengeIp.windowMs);
      if (!ip.ok) return reject(429, "RATE_LIMITED", "Too many challenges from this network. Wait a few minutes.", { "Retry-After": String(ip.retryAfterSec) });
    }
    const res = await challengeClaim(deps, room, session.wallet, { ...parsed.data, text, sourceUrl });
    return ok(res, res.status === "created" ? 201 : 200);
  } catch (e) {
    return debateErrorResponse(e);
  }
}
