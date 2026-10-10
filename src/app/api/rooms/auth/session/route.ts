import { NextRequest } from "next/server";
import { sessionCookieOptions, SESSION_COOKIE } from "@/lib/rooms/auth";
import { currentSession, ok, sameOriginOrReject } from "@/lib/rooms/http";

/** GET: the verified wallet for this browser's room session, or null. */
export async function GET(req: NextRequest) {
  const s = currentSession(req);
  return ok({ wallet: s?.wallet ?? null, expiresAt: s ? new Date(s.expiresAt).toISOString() : null });
}

/** DELETE: end the room session (sign out). */
export async function DELETE(req: NextRequest) {
  const cross = sameOriginOrReject(req);
  if (cross) return cross;
  const res = ok({ wallet: null });
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(process.env, 0));
  return res;
}
