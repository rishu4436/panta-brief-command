import { NextRequest } from "next/server";
import { RoomAuthError, sessionCookieOptions, sessionSecret, signSession, verifyChallenge, SESSION_COOKIE } from "@/lib/rooms/auth";
import { roomDeps } from "@/lib/rooms/deps";
import { AUTH_BODY_MAX_BYTES, errorResponse, ok, originHost, readJson, reject, sameOriginOrReject } from "@/lib/rooms/http";

/**
 * POST /api/rooms/auth/verify {nonce, signature(base58)} → sets the HttpOnly
 * room session for the wallet named in the stored challenge.
 */
export async function POST(req: NextRequest) {
  const cross = sameOriginOrReject(req);
  if (cross) return cross;
  const secret = sessionSecret();
  if (!secret) {
    return errorResponse(new RoomAuthError("AUTH_UNCONFIGURED", 503, "Wallet sign-in isn't configured on this deployment (missing session secret)."));
  }
  const read = await readJson(req, "verify", AUTH_BODY_MAX_BYTES);
  if (!read.ok) return read.res;
  const body = read.body as { nonce?: unknown; signature?: unknown } | null;
  if (!body || typeof body !== "object" || Object.keys(body).some((k) => k !== "nonce" && k !== "signature")) {
    return reject(400, "INVALID_REQUEST", "Send only { nonce, signature }.");
  }
  const { repo, now } = roomDeps();
  try {
    const t = now();
    const { wallet } = await verifyChallenge(repo, { nonce: body.nonce, signature: body.signature, originHost: originHost(req), now: t });
    const { value, session } = signSession(wallet, t, secret);
    const res = ok({ wallet, expiresAt: new Date(session.expiresAt).toISOString() });
    res.cookies.set(SESSION_COOKIE, value, sessionCookieOptions());
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
