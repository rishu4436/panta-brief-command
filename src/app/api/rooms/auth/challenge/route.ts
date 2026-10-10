import { NextRequest } from "next/server";
import { issueChallenge } from "@/lib/rooms/auth";
import { roomDeps } from "@/lib/rooms/deps";
import { AUTH_BODY_MAX_BYTES, errorResponse, ok, readJson, reject, requestOrigin, sameOriginOrReject } from "@/lib/rooms/http";

/** POST /api/rooms/auth/challenge {wallet} → the exact message to sign (single use, 5 min). */
export async function POST(req: NextRequest) {
  const cross = sameOriginOrReject(req);
  if (cross) return cross;
  const read = await readJson(req, "challenge", AUTH_BODY_MAX_BYTES);
  if (!read.ok) return read.res;
  const body = read.body as { wallet?: unknown } | null;
  if (!body || typeof body !== "object" || Object.keys(body).some((k) => k !== "wallet")) {
    return reject(400, "INVALID_REQUEST", "Send only { wallet }.");
  }
  const { repo, now } = roomDeps();
  try {
    const c = await issueChallenge(repo, { wallet: String(body.wallet ?? ""), origin: requestOrigin(req), now: now() });
    return ok({
      nonce: c.nonce,
      message: c.message,
      wallet: c.wallet,
      issuedAt: new Date(c.issuedAt).toISOString(),
      expiresAt: new Date(c.expiresAt).toISOString(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
