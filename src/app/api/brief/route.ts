import { NextRequest, NextResponse } from "next/server";
import { maybeOpenAIBrief } from "@/lib/brief";
import { BRIEF_MODE_IDS, BRIEF_RATE_LIMIT, isBriefMode } from "@/lib/brief-modes";
import { BASE58_PUBKEY_RE } from "@/lib/panta/routes";
import { sanitizeMarket, sanitizeTape } from "@/lib/panta/sanitize";
import { getMarketServer, getMarketTradesServer, UpstreamError } from "@/lib/panta/server";
import { computeMarketSignals } from "@/lib/panta/signals";
import { clientIp, rateLimit, TtlCache } from "@/lib/rate-limit";
import type { BriefMode, BriefPayload } from "@/lib/types";

/**
 * POST /api/brief  { marketId, mode }
 *
 * The browser supplies only a market id and an analytical mode. Evidence
 * (market detail + tape) is fetched here from Panta with the server key,
 * parsed by the adapter layer (zod), normalized into deterministic signals
 * (src/lib/panta/signals.ts), and only then interpreted by the LLM or the
 * template. Clients cannot inject data.
 */

const MAX_BODY_BYTES = 2 * 1024;
const RATE_WINDOW_MS = 60_000;
/** Repeat clicks within 60s are served from cache (no model re-billing). */
const CACHE_TTL_MS = 60_000;
const ALLOWED_KEYS = new Set(["marketId", "mode"]);
/** Tape rows used for signals (Panta caps at 200); the prompt never sees raw rows. */
const SIGNAL_TAPE_ROWS = 50;

const cache = new TtlCache<BriefPayload>(CACHE_TTL_MS);

function fail(status: number, code: string, detail?: string, headers?: HeadersInit) {
  return NextResponse.json(
    { error: code, code, ...(detail ? { detail } : {}) },
    { status, headers },
  );
}

async function buildBrief(marketId: string, mode: BriefMode): Promise<BriefPayload> {
  const [detail, trades] = await Promise.all([
    getMarketServer(marketId),
    getMarketTradesServer(marketId, SIGNAL_TAPE_ROWS).catch(() => []),
  ]);
  if (!detail) throw new UpstreamError(404, "MARKET_NOT_FOUND");
  const market = sanitizeMarket(detail);
  const signals = computeMarketSignals(market, trades.slice(0, SIGNAL_TAPE_ROWS));
  const { narrative, source } = await maybeOpenAIBrief(market, signals, mode);
  return {
    market,
    tape: sanitizeTape(trades),
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

  // 2) Per-IP rate limit (in-memory, per instance).
  const rl = rateLimit(`brief:${clientIp(req.headers)}`, BRIEF_RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) {
    return fail(429, "RATE_LIMITED", `Max ${BRIEF_RATE_LIMIT} briefs per minute`, {
      "Retry-After": String(rl.retryAfterSec),
    });
  }

  // 3) Strict body: { marketId, mode } only.
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return fail(413, "PAYLOAD_TOO_LARGE");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "INVALID_JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(400, "INVALID_REQUEST", "Body must be { marketId, mode }");
  }
  const extra = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
  if (extra.length) {
    return fail(
      400,
      "UNEXPECTED_FIELDS",
      `Only marketId and mode are accepted (got: ${extra.slice(0, 5).join(", ").slice(0, 80)})`,
    );
  }
  const { marketId, mode: modeRaw } = body as { marketId?: unknown; mode?: unknown };
  if (typeof marketId !== "string" || !BASE58_PUBKEY_RE.test(marketId)) {
    return fail(400, "INVALID_MARKET_ID");
  }
  const mode: BriefMode | null =
    modeRaw === undefined ? "desk" : isBriefMode(modeRaw) ? modeRaw : null;
  if (!mode) return fail(400, "INVALID_MODE", `mode must be one of ${BRIEF_MODE_IDS.join(", ")}`);

  // 4) Cache / in-flight dedupe keyed by marketId+mode (~60s) so repeat clicks
  //    don't re-bill the model.
  try {
    const { value, cached } = await cache.getOrCompute(`${marketId}:${mode}`, () =>
      buildBrief(marketId, mode),
    );
    return NextResponse.json(
      { ...value, cached },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof UpstreamError) {
      return fail(err.status, err.code);
    }
    return fail(500, "BRIEF_FAILED");
  }
}
