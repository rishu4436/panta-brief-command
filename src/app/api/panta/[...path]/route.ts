import { NextRequest, NextResponse } from "next/server";
import {
  isValidAttributionRef,
  matchProxyRoute,
  type ProxyMethod,
} from "@/lib/panta/routes";

/**
 * Allowlisted server proxy: browser → /api/panta/<route> → Panta live API.
 * Only routes in src/lib/panta/routes.ts are forwarded. The server key is the
 * only credential ever sent upstream; client-supplied X-Api-Key /
 * Authorization headers are ignored.
 */

const UPSTREAM =
  process.env.PANTA_API_BASE_URL?.replace(/\/$/, "") ||
  "https://live-api.panta.market/api/v1";

/** Max JSON body accepted from the browser (Panta write bodies are < 1 KB). */
const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUERY_VALUE = 256;
const UPSTREAM_TIMEOUT_MS = 15_000;
/** Individual path segments: fixed words or base58 ids only. */
const SEGMENT_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Ctx = { params: Promise<{ path: string[] }> };

function deny(status: number, error: string, detail?: string, extra?: HeadersInit) {
  return NextResponse.json(
    { error, code: error, ...(detail ? { detail } : {}) },
    { status, headers: extra },
  );
}

async function forward(req: NextRequest, ctx: Ctx, method: ProxyMethod) {
  // --- Path hygiene: no traversal, no encoded separators, no percent-encoding at all.
  const rawPath = req.nextUrl.pathname;
  if (/%|\\|\/\.{1,2}(\/|$)/.test(rawPath)) {
    return deny(400, "INVALID_PATH", "Encoded or traversal path segments are not allowed");
  }
  const { path } = await ctx.params;
  const segments = (path || []).filter((s) => s !== "");
  if (!segments.length || !segments.every((s) => SEGMENT_RE.test(s))) {
    return deny(400, "INVALID_PATH");
  }
  const normalized = segments.join("/");

  // --- Allowlist + method check.
  const route = matchProxyRoute(normalized);
  if (!route) return deny(403, "ROUTE_NOT_ALLOWED");
  if (!route.methods.includes(method)) {
    return deny(405, "METHOD_NOT_ALLOWED", undefined, {
      Allow: route.methods.join(", "),
    });
  }

  const apiKey = process.env.PANTA_API_KEY?.trim();
  if (!apiKey) {
    return deny(401, "UNAUTHORIZED", "PANTA_API_KEY is not configured on the server");
  }

  // --- Query: only keys documented for this route, bounded length.
  const url = new URL(`${UPSTREAM}/${normalized}/`);
  for (const key of route.query || []) {
    const v = req.nextUrl.searchParams.get(key);
    if (v == null || v === "") continue;
    if (v.length > MAX_QUERY_VALUE) return deny(400, "INVALID_QUERY", `${key} too long`);
    url.searchParams.set(key, v);
  }

  // --- Headers: allowlist only. Never forward client X-Api-Key / Authorization.
  const headers = new Headers();
  headers.set("X-Api-Key", apiKey);
  headers.set("Accept", "application/json");

  if (route.forwardUserId) {
    const userId = req.headers.get("x-user-id")?.trim();
    if (userId) {
      if (!isValidAttributionRef(userId)) {
        return deny(400, "INVALID_ATTRIBUTION_REF");
      }
      headers.set("X-User-Id", userId);
    }
  }

  const init: RequestInit = {
    method,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  };

  if (method === "POST") {
    const declared = Number(req.headers.get("content-length") || "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return deny(413, "PAYLOAD_TOO_LARGE");
    }
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    if (!ct.startsWith("application/json")) {
      return deny(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
    }
    const text = await req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return deny(413, "PAYLOAD_TOO_LARGE");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return deny(400, "INVALID_JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return deny(400, "INVALID_JSON", "Body must be a JSON object");
    }
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(parsed);
  }

  try {
    let upstream = await fetch(url.toString(), init);
    let text = await upstream.text();

    // Retry without trailing slash on MARKET_NOT_FOUND (some gateways differ).
    if (upstream.status === 404 && method === "GET" && /MARKET_NOT_FOUND/i.test(text)) {
      const alt = new URL(url.toString());
      alt.pathname = alt.pathname.replace(/\/$/, "");
      upstream = await fetch(alt.toString(), {
        ...init,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      text = await upstream.text();
    }

    const out = new Headers({
      "Content-Type": upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    });
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) out.set("Retry-After", retryAfter);

    return new NextResponse(text, { status: upstream.status, headers: out });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return NextResponse.json(
      {
        error: timedOut ? "UPSTREAM_TIMEOUT" : "PROXY_UNREACHABLE",
        code: timedOut ? "UPSTREAM_TIMEOUT" : "PROXY_UNREACHABLE",
        detail: timedOut ? "Panta API did not respond in time" : "Panta API unreachable",
      },
      { status: timedOut ? 504 : 502 },
    );
  }
}

// Only the methods the app actually uses. Next.js answers 405 for any other
// method (PUT/PATCH/DELETE) before this module runs.
export function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, ctx, "GET");
}

export function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, ctx, "POST");
}
