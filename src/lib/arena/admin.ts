import "server-only";

/**
 * Server-only admin token for arena finalization (ROOMS_ADMIN_TOKEN).
 * Fails closed: unset or shorter than 32 characters → finalization is
 * disabled. Compared in constant time (SHA-256 digests + timingSafeEqual),
 * sent only as `Authorization: Bearer <token>` (never a cookie, so it can't
 * be ridden cross-site).
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const ADMIN_TOKEN_MIN_LENGTH = 32;

export type AdminCheck = { ok: true } | { ok: false; status: 401 | 503; code: "ARENA_ADMIN_UNCONFIGURED" | "ARENA_ADMIN_UNAUTHORIZED" };

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

export function checkAdminToken(authorization: string | null, env: Record<string, string | undefined> = process.env): AdminCheck {
  const expected = (env.ROOMS_ADMIN_TOKEN || "").trim();
  if (expected.length < ADMIN_TOKEN_MIN_LENGTH) return { ok: false, status: 503, code: "ARENA_ADMIN_UNCONFIGURED" };
  const m = /^Bearer ([^\s]+)$/.exec((authorization || "").trim());
  const given = m ? m[1] : "";
  // Always compare (fixed-size digests) so timing doesn't reveal length or prefix.
  const same = timingSafeEqual(digest(given), digest(expected));
  return same && given.length > 0 ? { ok: true } : { ok: false, status: 401, code: "ARENA_ADMIN_UNAUTHORIZED" };
}
