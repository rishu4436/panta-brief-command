import { NextRequest } from "next/server";
import { revokeSessionCookie, sessionCookieOptions, sessionSecret, SESSION_COOKIE } from "@/lib/rooms/auth";
import { ok, reject, resolveSession, sameOriginOrReject } from "@/lib/rooms/http";
import { roomRepository } from "@/lib/rooms/store";

/**
 * GET: the verified wallet for this browser's room session, or null. Never
 * returns the session id. 503 when the session store can't confirm it.
 */
export async function GET(req: NextRequest) {
  const c = await resolveSession(req);
  if (c.unavailable) return reject(503, "SESSION_STORE_UNAVAILABLE", "Sign-in couldn't be confirmed right now. Try again.");
  const s = c.session;
  return ok({ wallet: s?.wallet ?? null, expiresAt: s ? new Date(s.expiresAt).toISOString() : null });
}

/**
 * DELETE: sign out. Revokes the server-side session record (so a copied
 * cookie stops working at once), then clears the cookie. Idempotent. If the
 * store can't revoke, the answer is 503 and the cookie is KEPT, so the user
 * can retry: clearing it would hide a session that is still live elsewhere.
 */
export async function DELETE(req: NextRequest) {
  const cross = sameOriginOrReject(req);
  if (cross) return cross;
  let revoked = true;
  try {
    await revokeSessionCookie(roomRepository(), req.cookies.get(SESSION_COOKIE)?.value, Date.now(), sessionSecret());
  } catch {
    revoked = false;
  }
  if (!revoked) return reject(503, "SESSION_REVOKE_FAILED", "Sign-out couldn't be confirmed on the server (session storage didn't respond). Try again.");
  const res = ok({ wallet: null });
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(process.env, 0));
  return res;
}
