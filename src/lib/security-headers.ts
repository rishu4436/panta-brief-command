/**
 * Content-Security-Policy + anti-framing headers, applied to every route by
 * next.config.ts. Pure (no Next/alias imports) so next.config can load it.
 *
 * Why each directive:
 *  - frame-ancestors 'none' + X-Frame-Options DENY: nobody can frame the
 *    desk, so the Approve / sign flow can't be click-jacked.
 *  - script-src 'self' 'unsafe-inline': the App Router streams its RSC
 *    payload through inline <script> tags (self.__next_f.push). The strict
 *    alternative is a per-request nonce from middleware, which forces every
 *    page to render dynamically: a redesign, out of scope. External script
 *    hosts stay blocked, and there is no 'unsafe-eval' in production (dev
 *    only, for React Refresh).
 *  - style-src 'self' 'unsafe-inline': inline style attributes (progress
 *    bars, wallet-adapter UI) and next/font's injected @font-face.
 *  - img-src https: data: blob: — market images are creator-supplied URLs on
 *    arbitrary hosts (Cloudinary and others); wallet icons are data: URIs.
 *    Images can't run script.
 *  - font-src 'self' data: — next/font/google self-hosts the files.
 *  - connect-src 'self' + one exact URL: Solana RPC goes through our /api/rpc
 *    relay (the provider URL + key stay server-side; confirmation is HTTP
 *    polling, so no wss), and Panta through our /api/panta proxy. No RPC or
 *    Panta host is needed in the browser. The single exception is Panta's
 *    signed Cloudinary upload endpoint (CLOUDINARY_UPLOAD_URL in
 *    src/lib/panta/create-rules.ts): Panta's official image-upload flow
 *    sends the image bytes straight from the browser to Cloudinary ("image
 *    bytes never pass through Panta"), so we allow exactly that path — not
 *    the host, not other clouds — instead of proxying bytes ourselves.
 *  - frame-src 'self' https://connect.solflare.com: the Solflare adapter opens its
 *    SDK iframe there when the extension isn't installed; 'self' is for the
 *    room creator's embed preview (an /embed/** page). Phantom / Solflare
 *    extensions inject via content scripts, which page CSP doesn't block.
 *  - object-src 'none', base-uri 'self', form-action 'self'.
 */

export const SOLFLARE_FRAME = "https://connect.solflare.com";
/** Must equal CLOUDINARY_UPLOAD_URL (create-rules.ts); kept literal so next.config can load this file. */
export const CREATE_IMAGE_UPLOAD_ENDPOINT = "https://api.cloudinary.com/v1_1/dyvupboym/image/upload";

export function buildCsp(opts: { dev?: boolean } = {}): string {
  const connect = ["'self'", CREATE_IMAGE_UPLOAD_ENDPOINT];
  if (opts.dev) connect.push("ws:", "wss:"); // HMR socket
  const script = ["'self'", "'unsafe-inline'", ...(opts.dev ? ["'unsafe-eval'"] : [])];
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", script],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "https:", "data:", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", connect],
    // 'self': the room creator's live embed preview (/embed/rooms/...). The app itself still can't be framed.
    ["frame-src", ["'self'", SOLFLARE_FRAME]],
    ["worker-src", ["'self'", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

export function securityHeaders(env: Record<string, string | undefined> = process.env): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: buildCsp({ dev: env.NODE_ENV === "development" }) },
    { key: "X-Frame-Options", value: "DENY" },
  ];
}

// ---------------------------------------------------------------------------
// Embeds (/embed/**) — the ONLY routes that may be framed by other sites.
//
// next.config applies securityHeaders() to every path EXCEPT /embed/**; the
// embed route handlers send embedSecurityHeaders() themselves (every
// /embed/** path, including unknown ones, is served by those handlers).
//  - frame-ancestors https: (+ http://localhost / 127.0.0.1 in development);
//    no X-Frame-Options (it can't express "any site").
//  - default-src 'none': no script at all, no connections, no fonts.
//  - style-src = the hash of the one inline stylesheet; no style attributes.
//  - img-src 'self' data: (no third-party images).
//  - sandbox allow-popups allow-popups-to-escape-sandbox: even when opened
//    directly or framed without a sandbox attribute, the page runs with an
//    opaque origin, no scripts, no forms; links still open a normal tab.

export const EMBED_PATH_PREFIX = "/embed/";

export function buildEmbedCsp(opts: { dev?: boolean; styleHash: string }): string {
  const ancestors = ["https:", ...(opts.dev ? ["http://localhost:*", "http://127.0.0.1:*"] : [])];
  const directives: [string, string[]][] = [
    ["default-src", ["'none'"]],
    ["style-src", [`'${opts.styleHash}'`]],
    ["img-src", ["'self'", "data:"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'none'"]],
    ["frame-ancestors", ancestors],
    ["sandbox", ["allow-popups", "allow-popups-to-escape-sandbox"]],
  ];
  return directives.map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

export function embedSecurityHeaders(styleHash: string, env: Record<string, string | undefined> = process.env): Record<string, string> {
  return {
    "Content-Security-Policy": buildEmbedCsp({ dev: env.NODE_ENV === "development", styleHash }),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  };
}
