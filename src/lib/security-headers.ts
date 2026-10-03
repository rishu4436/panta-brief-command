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
 *  - connect-src: own API routes ('self') + the configured Solana RPC over
 *    https and its wss (web3.js confirmation subscriptions), plus the public
 *    mainnet endpoint used as the fallback. Panta is reached only via our
 *    /api/panta proxy, so its host is not needed in the browser.
 *  - frame-src https://connect.solflare.com: the Solflare adapter opens its
 *    SDK iframe there when the extension isn't installed. Phantom / Solflare
 *    extensions inject via content scripts, which page CSP doesn't block.
 *  - object-src 'none', base-uri 'self', form-action 'self'.
 */

import { PUBLIC_MAINNET_RPC } from "./rpc";

export const SOLFLARE_FRAME = "https://connect.solflare.com";

/** https://host[:port] and wss://host[:port] for an RPC URL; [] if unparseable. */
export function rpcOrigins(rpc: string | undefined | null): string[] {
  const v = rpc?.trim();
  if (!v) return [];
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return [];
    const ws = u.protocol === "https:" ? "wss:" : "ws:";
    return [`${u.protocol}//${u.host}`, `${ws}//${u.host}`];
  } catch {
    return [];
  }
}

export function buildCsp(opts: { rpc?: string | null; dev?: boolean } = {}): string {
  const connect = Array.from(new Set(["'self'", ...rpcOrigins(opts.rpc), ...rpcOrigins(PUBLIC_MAINNET_RPC)]));
  if (opts.dev) connect.push("ws:", "wss:"); // HMR socket
  const script = ["'self'", "'unsafe-inline'", ...(opts.dev ? ["'unsafe-eval'"] : [])];
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", script],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "https:", "data:", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", connect],
    ["frame-src", [SOLFLARE_FRAME]],
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
    { key: "Content-Security-Policy", value: buildCsp({ rpc: env.NEXT_PUBLIC_DEFAULT_RPC, dev: env.NODE_ENV === "development" }) },
    { key: "X-Frame-Options", value: "DENY" },
  ];
}
