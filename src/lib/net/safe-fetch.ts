import "server-only";

/**
 * Safe server-side fetcher for untrusted URLs (a market's declared sources of
 * truth, user-submitted links). Used by the AI Debate Arena's evidence layer;
 * never for Panta, RPC or anything with credentials.
 *
 *  - https only (http, ftp, data, file, javascript… are refused), port 443,
 *    no userinfo, hostnames like localhost / *.local / *.internal refused;
 *  - DNS resolved here; EVERY resolved address must be public (private,
 *    loopback, link-local, CGNAT, multicast, reserved, documentation, IPv6
 *    ULA / link-local, IPv4-mapped / NAT64 / 6to4 forms of those, and cloud
 *    metadata addresses are refused). IP literals in any spelling are
 *    normalised by the WHATWG URL parser first (2130706433, 0x7f.1, 0177.0.0.1
 *    → 127.0.0.1) and checked the same way;
 *  - the connection is pinned to the validated address (custom `lookup`), so
 *    a second DNS answer can't rebind it to an internal host; TLS still
 *    verifies the certificate for the original hostname (SNI);
 *  - redirects are followed manually, at most 3, and each hop is re-validated
 *    from scratch (scheme, host, DNS, address);
 *  - one overall timeout; a byte cap on the (decompressed) body; a
 *    content-type allowlist; no cookies, no auth headers, no Referer.
 *
 * The result is plain text (HTML is reduced to text with scripts, styles and
 * other active content removed). Nothing fetched is ever rendered as HTML.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";

export const SAFE_FETCH_DEFAULTS = {
  timeoutMs: 8_000,
  maxBytes: 1_000_000,
  maxRedirects: 3,
} as const;

export const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain", "application/json"] as const;

export type SafeFetchErrorCode =
  | "INVALID_URL"
  | "SCHEME_NOT_ALLOWED"
  | "CREDENTIALS_NOT_ALLOWED"
  | "PORT_NOT_ALLOWED"
  | "HOST_NOT_ALLOWED"
  | "ADDRESS_NOT_ALLOWED"
  | "DNS_FAILED"
  | "TOO_MANY_REDIRECTS"
  | "BAD_REDIRECT"
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "CONTENT_TYPE_NOT_ALLOWED"
  | "NETWORK";

export class SafeFetchError extends Error {
  constructor(
    public code: SafeFetchErrorCode,
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "SafeFetchError";
  }
}

// ------------------------------------------------------------------ addresses

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local + cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["100::", 64], // discard-only
  ["2001:db8::", 32], // documentation
  ["2001::", 32], // Teredo (tunnels to arbitrary IPv4)
  ["fc00::", 7], // unique local (incl. fd00:ec2::254 metadata)
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

/** IPv4 embedded in IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible, NAT64 (64:ff9b::/96) or 6to4 (2002:AABB:CCDD::) forms. */
function embeddedIpv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const groups = expandIpv6(lower);
  if (!groups) return null;
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  // ::ffff:x:y, ::x:y (compat), 64:ff9b::x:y
  if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0xffff || groups[5] === 0)) return v4(groups[6], groups[7]);
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) return v4(groups[6], groups[7]);
  if (groups[0] === 0x2002) return v4(groups[1], groups[2]);
  return null;
}

function expandIpv6(ip: string): number[] | null {
  let s = ip;
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const nums = all.map((g) => parseInt(g, 16));
  return nums.length === 8 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? nums : null;
}

/** True when the address may be connected to (public unicast). */
export function isPublicAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return !blocked.check(ip, "ipv4");
  if (fam === 6) {
    const inner = embeddedIpv4(ip);
    if (inner !== null) return isIP(inner) === 4 && !blocked.check(inner, "ipv4");
    return !blocked.check(ip, "ipv6");
  }
  return false;
}

const BLOCKED_HOST_RE = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|arpa|test|invalid|example)$/i;
const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata", "instance-data", "metadata.azure.com"]);

export type ValidatedUrl = { url: URL; host: string; literalIp: string | null };

/** Syntax + policy checks that need no network (scheme, credentials, port, host names, literal IPs). */
export function validateUrlSyntax(raw: string | URL): ValidatedUrl {
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw.trim()) : new URL(raw.href);
  } catch {
    throw new SafeFetchError("INVALID_URL", "not a valid absolute URL");
  }
  if (url.protocol !== "https:") throw new SafeFetchError("SCHEME_NOT_ALLOWED", `only https is allowed (got ${url.protocol.replace(":", "")})`);
  if (url.username || url.password) throw new SafeFetchError("CREDENTIALS_NOT_ALLOWED", "URLs with credentials are refused");
  if (url.port && url.port !== "443") throw new SafeFetchError("PORT_NOT_ALLOWED", "only the default https port is allowed");
  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) throw new SafeFetchError("INVALID_URL", "missing host");
  if (host.endsWith(".")) host = host.slice(0, -1);
  const literal = isIP(host) ? host : null;
  if (literal) {
    if (!isPublicAddress(literal)) throw new SafeFetchError("ADDRESS_NOT_ALLOWED", "address is not public");
  } else {
    if (!host.includes(".") || BLOCKED_HOST_RE.test(host) || METADATA_HOSTS.has(host)) throw new SafeFetchError("HOST_NOT_ALLOWED", "host name is not allowed");
  }
  url.hash = "";
  return { url, host, literalIp: literal };
}

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (host: string) => Promise<ResolvedAddress[]>;

export const systemResolver: Resolver = async (host) => {
  const all = await dnsLookup(host, { all: true, verbatim: true });
  return all.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

/** Resolve and require EVERY answer to be public; returns the address to pin. */
export async function resolvePublic(v: ValidatedUrl, resolve: Resolver): Promise<ResolvedAddress> {
  if (v.literalIp) return { address: v.literalIp, family: isIP(v.literalIp) === 6 ? 6 : 4 };
  let answers: ResolvedAddress[];
  try {
    answers = await resolve(v.host);
  } catch {
    throw new SafeFetchError("DNS_FAILED", "host did not resolve");
  }
  if (!answers.length) throw new SafeFetchError("DNS_FAILED", "host did not resolve");
  for (const a of answers) if (!isPublicAddress(a.address)) throw new SafeFetchError("ADDRESS_NOT_ALLOWED", "host resolves to a non-public address");
  return answers[0];
}

// ------------------------------------------------------------------ transport

export type TransportResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  /** Stop reading (closes the socket). */
  abort: () => void;
};

/** One HTTPS request to `url`, connecting ONLY to `pinned` (tests inject a fake). */
export type Transport = (url: URL, pinned: ResolvedAddress, signal: AbortSignal) => Promise<TransportResponse>;

const REQUEST_HEADERS = {
  "User-Agent": "BriefCommandEvidenceFetcher/1.0 (+https://briefcommand.vercel.app; research evidence, read-only)",
  Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "en",
} as const;

export const httpsTransport: Transport = (url, pinned, signal) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: REQUEST_HEADERS,
        servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname,
        agent: false,
        signal,
        // Pin the connection to the address we validated (no second DNS lookup).
        lookup: (_host, opts, cb) => {
          if ((opts as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: pinned.address, family: pinned.family }]);
          else cb(null, pinned.address, pinned.family);
        },
      },
      (res) => {
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
        resolve({ status: res.statusCode ?? 0, headers, body: res as Readable, abort: () => res.destroy() });
      },
    );
    req.on("error", reject);
    req.end();
  });

// ------------------------------------------------------------------ fetch

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  resolve?: Resolver;
  transport?: Transport;
};

export type SafeFetchResult = {
  /** Final URL after redirects. */
  url: string;
  requestedUrl: string;
  redirects: string[];
  status: number;
  contentType: string;
  /** Plain text (HTML reduced to text). */
  text: string;
  title: string | null;
  truncated: boolean;
  bytes: number;
};

function mediaType(ct: string | undefined): string {
  return (ct || "").split(";")[0].trim().toLowerCase();
}

function decode(body: AsyncIterable<Uint8Array>, encoding: string | undefined): AsyncIterable<Uint8Array> {
  const enc = (encoding || "identity").trim().toLowerCase();
  if (enc === "identity" || enc === "") return body;
  const z = enc === "gzip" || enc === "x-gzip" ? createGunzip() : enc === "deflate" ? createInflate() : enc === "br" ? createBrotliDecompress() : null;
  if (!z) throw new SafeFetchError("CONTENT_TYPE_NOT_ALLOWED", `unsupported content-encoding ${enc.slice(0, 20)}`);
  (async () => {
    try {
      for await (const chunk of body) if (!z.write(chunk)) await new Promise((r) => z.once("drain", r));
      z.end();
    } catch (e) {
      z.destroy(e as Error);
    }
  })();
  return z as unknown as AsyncIterable<Uint8Array>;
}

/**
 * GET an untrusted https URL under the policy above. Throws SafeFetchError
 * with a stable code; never returns content from a refused hop.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs;
  const maxBytes = opts.maxBytes ?? SAFE_FETCH_DEFAULTS.maxBytes;
  const maxRedirects = opts.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects;
  const resolve = opts.resolve ?? systemResolver;
  const transport = opts.transport ?? httpsTransport;
  let current = validateUrlSyntax(rawUrl); // before any timer: a refused URL leaves nothing pending
  const requestedUrl = current.url.href;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const deadline = new Promise<never>((_, reject) => {
    ctrl.signal.addEventListener("abort", () => reject(new SafeFetchError("TIMEOUT", `no complete response within ${timeoutMs} ms`)), { once: true });
  });
  deadline.catch(() => undefined); // only observed through Promise.race
  const redirects: string[] = [];
  try {
    for (let hop = 0; ; hop++) {
      const pinned = await Promise.race([resolvePublic(current, resolve), deadline]);
      let res: TransportResponse;
      try {
        res = await Promise.race([transport(current.url, pinned, ctrl.signal), deadline]);
      } catch (e) {
        if (e instanceof SafeFetchError) throw e;
        if (timedOut) throw new SafeFetchError("TIMEOUT", `no response within ${timeoutMs} ms`);
        throw new SafeFetchError("NETWORK", "connection failed");
      }
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        res.abort();
        const loc = res.headers.location;
        if (!loc) throw new SafeFetchError("BAD_REDIRECT", "redirect without a Location");
        if (hop + 1 > maxRedirects) throw new SafeFetchError("TOO_MANY_REDIRECTS", `more than ${maxRedirects} redirects`);
        let next: URL;
        try {
          next = new URL(loc, current.url);
        } catch {
          throw new SafeFetchError("BAD_REDIRECT", "unparseable Location");
        }
        current = validateUrlSyntax(next); // full re-validation for every hop
        redirects.push(current.url.href);
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        res.abort();
        throw new SafeFetchError("HTTP_ERROR", `HTTP ${res.status}`);
      }
      const type = mediaType(res.headers["content-type"]);
      if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(type)) {
        res.abort();
        throw new SafeFetchError("CONTENT_TYPE_NOT_ALLOWED", `content type ${type.slice(0, 60) || "(none)"} is not allowed`);
      }
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      let truncated = false;
      const read = (async () => {
        for await (const chunk of decode(res.body, res.headers["content-encoding"])) {
          const room = maxBytes - bytes;
          if (chunk.byteLength >= room) {
            chunks.push(chunk.subarray(0, room));
            bytes += room;
            truncated = true;
            res.abort();
            break;
          }
          chunks.push(chunk);
          bytes += chunk.byteLength;
        }
      })();
      try {
        await Promise.race([read, deadline]);
      } catch (e) {
        res.abort();
        if (e instanceof SafeFetchError) throw e;
        if (!truncated) throw new SafeFetchError("NETWORK", "body read failed");
      }
      const raw = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
      const extracted = type === "text/html" || type === "application/xhtml+xml" ? htmlToText(raw) : { text: normalizeText(raw), title: null };
      return { url: current.url.href, requestedUrl, redirects, status: res.status, contentType: type, text: extracted.text, title: extracted.title, truncated, bytes };
    }
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ text extraction

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k in ENTITIES) return ENTITIES[k];
    if (k.startsWith("#x")) {
      const n = parseInt(k.slice(2), 16);
      return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    if (k.startsWith("#")) {
      const n = parseInt(k.slice(1), 10);
      return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return m;
  });
}

export function normalizeText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** HTML → inert plain text: active/non-content elements removed, tags stripped, entities decoded. */
export function htmlToText(html: string): { text: string; title: string | null } {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ");
  const t = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = t ? normalizeText(decodeEntities(t[1].replace(/<[^>]*>/g, " "))).replace(/\s+/g, " ").slice(0, 300) || null : null;
  s = s.replace(/<(script|style|noscript|template|svg|iframe|object|embed|canvas|head|nav|footer|form|select|button)\b[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<(script|style|iframe|object|embed|link|meta|input|img|source|track|base)\b[^>]*>/gi, " ");
  s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/blockquote)\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]*>/g, " ");
  s = s.replace(/<[^>]*$/g, " "); // a truncated trailing tag
  return { text: normalizeText(decodeEntities(s)), title };
}
