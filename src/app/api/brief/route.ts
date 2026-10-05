import { NextRequest, NextResponse } from "next/server";
import { maybeOpenAIBrief } from "@/lib/brief";
import { BRIEF_MODE_IDS, BRIEF_RATE_LIMIT, isBriefMode } from "@/lib/brief-modes";
import { BASE58_PUBKEY_RE } from "@/lib/panta/routes";
import { sanitizeMarket, sanitizeTape } from "@/lib/panta/sanitize";
import { getAuthoritativeMarket } from "@/lib/panta/catalog-server";
import { getMarketTradesServer, UpstreamError } from "@/lib/panta/server";
import { computeMarketSignals } from "@/lib/panta/signals";
import { clientIp } from "@/lib/rate-limit";
import { limitShared, SharedCache, storeHeaderValue, type LimitResult } from "@/lib/shared-store";
import type { BriefMode, BriefPayload } from "@/lib/types";

/**
 * POST /api/brief  { marketId, mode }
 *
 * The browser supplies only a market id and an analytical mode. Evidence
 * (authoritative market + tape) is fetched here with the server key: the
 * market is the same catalog/on-chain + detail merge as GET /api/catalog
 * (getAuthoritativeMarket), so a partial Panta detail cannot demote a known
 * secondary market to primary. Signals are deterministic
 * (src/lib/panta/signals.ts); the LLM / template only interprets them.
 * Clients cannot inject or override market data.
 */

const MAX_BODY_BYTES = 2 * 1024;
const RATE_WINDOW_MS = 60_000;
/** Repeat clicks within 60s are served from cache (no model re-billing). */
const CACHE_TTL_MS = 60_000;
const ALLOWED_KEYS = new Set(["marketId", "mode"]);
/** Tape rows used for signals (Panta caps at 200); the prompt never sees raw rows. */
const SIGNAL_TAPE_ROWS = 50;

const cache = new SharedCache<BriefPayload>("brief", CACHE_TTL_MS);

/** Standard rate-limit headers + which store enforced them (redis = shared, memory = per instance). */
function limitHeaders(rl: LimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(rl.limit),
    "X-RateLimit-Remaining": String(rl.remaining),
    "X-RateLimit-Reset": new Date(rl.resetAt).toISOString(),
    "X-RateLimit-Store": rl.store,
    // Explicit: memory = per instance, not shared (no Redis configured, or it failed).
    "X-Store-Status": storeHeaderValue(rl.store),
  };
}

function fail(status: number, code: string, detail?: string, headers?: Record<string, string>) {
  return NextResponse.json(
    { error: code, code, ...(detail ? { detail } : {}) },
    { status, headers },
  );
}

async function buildBrief(marketId: string, mode: BriefMode): Promise<BriefPayload> {
  // A failed tape fetch must surface as an error, not as an empty tape: an
  // empty array would be reported as "No recent prints" (and cached for 60s).
  const [authoritative, tape] = await Promise.all([
    getAuthoritativeMarket(marketId),
    getMarketTradesServer(marketId, SIGNAL_TAPE_ROWS),
  ]);
  if (!authoritative) throw new UpstreamError(404, "MARKET_NOT_FOUND");
  const market = sanitizeMarket(authoritative);
  // A partial page (some rows unreadable) is a partial sample: signals say so
  // and cap data quality; unreadable rows are never counted as zero prints.
  const signals = computeMarketSignals(market, tape.trades.slice(0, SIGNAL_TAPE_ROWS), Date.now(), {
    tapeCompleteness: tape.completeness,
  });
  const { narrative, source } = await maybeOpenAIBrief(market, signals, mode);
  return {
    market,
    tape: sanitizeTape(tape.trades),
    signals,
    narrative,
    source,
    mode,
    generatedAt: new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  // 1) Size cap before reading anything.
  const declared = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return fail(413, "PAYLOAD_TOO_LARGE");
  }

  // 2) Per-IP rate limit: shared (Upstash) when configured, else per instance.
  const rl = await limitShared(`brief:${clientIp(req.headers)}`, BRIEF_RATE_LIMIT, RATE_WINDOW_MS);
  const rlh = limitHeaders(rl);
  if (!rl.ok) {
    return fail(429, "RATE_LIMITED", `Max ${BRIEF_RATE_LIMIT} briefs per minute`, {
      ...rlh,
      "Retry-After": String(rl.retryAfterSec),
    });
  }

  // 3) Strict body: { marketId, mode } only.
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return fail(413, "PAYLOAD_TOO_LARGE", undefined, rlh);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "INVALID_JSON", undefined, rlh);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(400, "INVALID_REQUEST", "Body must be { marketId, mode }", rlh);
  }
  const extra = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
  if (extra.length) {
    return fail(
      400,
      "UNEXPECTED_FIELDS",
      `Only marketId and mode are accepted (got: ${extra.slice(0, 5).join(", ").slice(0, 80)})`,
      rlh,
    );
  }
  const { marketId, mode: modeRaw } = body as { marketId?: unknown; mode?: unknown };
  if (typeof marketId !== "string" || !BASE58_PUBKEY_RE.test(marketId)) {
    return fail(400, "INVALID_MARKET_ID", undefined, rlh);
  }
  const mode: BriefMode | null =
    modeRaw === undefined ? "desk" : isBriefMode(modeRaw) ? modeRaw : null;
  if (!mode) return fail(400, "INVALID_MODE", `mode must be one of ${BRIEF_MODE_IDS.join(", ")}`, rlh);

  // 4) Cache / in-flight dedupe keyed by marketId+mode (~60s) so repeat clicks
  //    don't re-bill the model.
  try {
    const { value, cached, store } = await cache.getOrCompute(`${marketId}:${mode}`, () =>
      buildBrief(marketId, mode),
    );
    return NextResponse.json(
      { ...value, cached },
      { headers: { ...rlh, "Cache-Control": "no-store", "X-Brief-Cache": `${cached ? "hit" : "miss"}; store=${store}` } },
    );
  } catch (err) {
    if (err instanceof UpstreamError) {
      return fail(err.status, err.code, err.detail, rlh);
    }
    return fail(500, "BRIEF_FAILED", undefined, rlh);
  }
}
