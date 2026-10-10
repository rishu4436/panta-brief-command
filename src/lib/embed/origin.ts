/**
 * Canonical public origin for links and embed snippets (pure).
 *
 * Read from configuration only (APP_ORIGIN, else NEXT_PUBLIC_APP_ORIGIN),
 * never from Host / X-Forwarded-Host, so a forged header can't put another
 * site's address into a snippet or canonical link.
 *  - Must be an absolute https origin (no path, query, fragment or
 *    credentials). http is accepted only for localhost / 127.0.0.1 outside
 *    production.
 *  - Unset or invalid: http://localhost:3100 in development / test, and the
 *    established production address https://briefcommand.vercel.app in
 *    production.
 */

export const PRODUCTION_FALLBACK_ORIGIN = "https://briefcommand.vercel.app";
export const DEV_FALLBACK_ORIGIN = "http://localhost:3100";

type Env = Record<string, string | undefined>;

export function validateOrigin(raw: string | undefined, production: boolean): string | null {
  const v = (raw || "").trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return null;
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol === "https:") return u.origin;
  if (u.protocol === "http:" && local && !production) return u.origin;
  return null;
}

export function appOrigin(env: Env = process.env): string {
  const production = env.NODE_ENV === "production";
  return validateOrigin(env.APP_ORIGIN, production) ?? validateOrigin(env.NEXT_PUBLIC_APP_ORIGIN, production) ?? (production ? PRODUCTION_FALLBACK_ORIGIN : DEV_FALLBACK_ORIGIN);
}
