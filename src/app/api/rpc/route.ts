import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/rate-limit";
import {
  parseRpcBody,
  redactUpstream,
  RPC_MAX_BODY_BYTES,
  RPC_RATE_LIMIT,
  RPC_UPSTREAM_TIMEOUT_MS,
  rpcError,
  rpcUpstream,
} from "@/lib/rpc-relay";
import { limitShared, storeHeaderValue } from "@/lib/shared-store";
import { isReadOnlyDeployment, PREVIEW_READ_ONLY } from "@/lib/deploy-env";

/**
 * POST /api/rpc — Solana JSON-RPC relay (see src/lib/rpc-relay.ts).
 * The upstream URL (with its key) is read from SOLANA_RPC_URL on the server
 * only; it is never logged, echoed or included in an error.
 */

const RATE_WINDOW_MS = 60_000;

function reply(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > RPC_MAX_BODY_BYTES) {
    return reply(rpcError(null, -32600, "Request too large"), 413);
  }

  const rl = await limitShared(`rpc:${clientIp(req.headers)}`, RPC_RATE_LIMIT, RATE_WINDOW_MS);
  const rlh: Record<string, string> = {
    "X-RateLimit-Limit": String(rl.limit),
    "X-RateLimit-Remaining": String(rl.remaining),
    "X-RateLimit-Reset": new Date(rl.resetAt).toISOString(),
    "X-RateLimit-Store": rl.store,
    "X-Store-Status": storeHeaderValue(rl.store),
  };
  if (!rl.ok) {
    return reply(rpcError(null, 429, "RATE_LIMITED"), 429, { ...rlh, "Retry-After": String(rl.retryAfterSec) });
  }

  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (!ct.startsWith("application/json")) return reply(rpcError(null, -32700, "Content-Type must be application/json"), 415, rlh);
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > RPC_MAX_BODY_BYTES) {
    return reply(rpcError(null, -32600, "Request too large"), 413, rlh);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return reply(rpcError(null, -32700, "Parse error"), 400, rlh);
  }
  const parsed = parseRpcBody(raw, { readOnly: isReadOnlyDeployment() });
  if (!parsed.ok) {
    const body = parsed.readOnly ? { ...rpcError(parsed.id, parsed.code, parsed.message), code: PREVIEW_READ_ONLY } : rpcError(parsed.id, parsed.code, parsed.message);
    return reply(body, parsed.status, rlh);
  }

  const upstream = rpcUpstream();
  if ("error" in upstream) {
    return reply({ ...rpcError(null, -32000, "RPC_NOT_CONFIGURED"), code: "RPC_NOT_CONFIGURED" }, 503, rlh);
  }

  const body = JSON.stringify(parsed.batch ? parsed.calls : parsed.calls[0]);
  let res: Response;
  try {
    res = await fetch(upstream.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(RPC_UPSTREAM_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return reply(rpcError(null, -32000, timedOut ? "RPC_UPSTREAM_TIMEOUT" : "RPC_UPSTREAM_UNREACHABLE"), timedOut ? 504 : 502, rlh);
  }
  const out = await res.text().catch(() => "");
  // Only well-formed JSON-RPC answers are passed through (redacted); anything
  // else (HTML error pages, provider messages) is replaced by a generic error.
  let json: unknown;
  try {
    json = JSON.parse(out);
  } catch {
    json = undefined;
  }
  const looksRpc = (v: unknown) => !!v && typeof v === "object" && (v as { jsonrpc?: unknown }).jsonrpc === "2.0";
  const valid = Array.isArray(json) ? json.length > 0 && json.every(looksRpc) : looksRpc(json);
  if (!valid) {
    const status = res.status === 429 ? 429 : 502;
    return reply(rpcError(null, -32000, res.status === 429 ? "RPC_UPSTREAM_RATE_LIMITED" : `RPC_UPSTREAM_HTTP_${res.status}`), status, rlh);
  }
  return new NextResponse(redactUpstream(out, upstream.url), {
    status: res.ok ? 200 : 502,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...rlh },
  });
}
