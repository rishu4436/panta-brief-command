import { NextRequest, NextResponse } from "next/server";
import { maybeOpenAIBrief } from "@/lib/brief";
import { BRIEF_MODE_IDS, isBriefMode } from "@/lib/brief-modes";
import { BASE58_PUBKEY_RE } from "@/lib/panta/routes";
import { sanitizeMarket, sanitizeTape } from "@/lib/panta/sanitize";
import { computeMarketSignals } from "@/lib/panta/signals";
import { clientIp, rateLimit, TtlCache } from "@/lib/rate-limit";
import type {
  BriefMode,
  BriefPayload,
  MarketCatalogItem,
  MarketTradesResponse,
} from "@/lib/types";

/**
 * POST /api/brief  { marketId, mode }
 *
 * The browser supplies only a market id and an analytical mode. Evidence
 * (market detail + tape) is fetched here from Panta with the server key,
 * normalized into deterministic signals (src/lib/panta/signals.ts), and only
 * then interpreted by the LLM or the template. Clients cannot inject data.
 */

const UPSTREAM =
  process.env.PANTA_API_BASE_URL?.replace(/\/$/, "") ||
  "https://live-api.panta.market/api/v1";

const MAX_BODY_BYTES = 2 * 1024;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const CACHE_TTL_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 10_000;
const ALLOWED_KEYS = new Set(["marketId", "mode"]);
/** Tape rows used for signals (Panta caps at 200); the prompt never sees raw rows. */
const SIGNAL_TAPE_ROWS = 50;
const DETAIL_RETRY_MS = [400, 900] as const;

type BriefResult = BriefPayload;

const cache = new TtlCache<BriefResult>(CACHE_TTL_MS);

class UpstreamError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

function fail(status: number, code: string, detail?: string, headers?: HeadersInit) {
  return NextResponse.json(
    { error: code, code, ...(detail ? { detail } : {}) },
    { status, headers },
  );
}

async function pantaGet<T>(path: string): Promise<T> {
  const key = process.env.PANTA_API_KEY?.trim();
  if (!key) throw new UpstreamError(503, "SERVER_KEY_MISSING");
  let res: Response;
  try {
    res = await fetch(`${UPSTREAM}${path}`, {
      headers: { Accept: "application/json", "X-Api-Key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError(502, "PANTA_UNREACHABLE");
  }
  if (!res.ok) {
    let code = `PANTA_HTTP_${res.status}`;
    try {
      const body = (await res.json()) as { code?: unknown };
      if (typeof body?.code === "string") code = body.code.slice(0, 64);
    } catch {
      /* non-JSON error */
    }
    throw new UpstreamError(res.status === 404 ? 404 : 502, code);
  }
  return (await res.json()) as T;
}

/**
 * The live detail endpoint intermittently returns a partial record (no title,
 * question or prices; ~41 fields instead of ~89). Retry briefly; if it stays
 * partial, signals carry a `partial_detail` flag instead of guessing values.
 */
function isPartialDetail(raw: MarketCatalogItem & { question?: unknown }): boolean {
  const hasText = Boolean(String(raw.title || raw.question || "").trim());
  const hasPrice = raw.yesPrice != null || raw.noPrice != null;
  return !hasText && !hasPrice;
}

async function fetchDetail(id: string): Promise<{ raw: MarketCatalogItem; partial: boolean }> {
  let raw = await pantaGet<MarketCatalogItem>(`/markets/${id}/`);
  for (const delay of DETAIL_RETRY_MS) {
    if (!isPartialDetail(raw)) return { raw, partial: false };
    await new Promise((r) => setTimeout(r, delay));
    raw = await pantaGet<MarketCatalogItem>(`/markets/${id}/`);
  }
  return { raw, partial: isPartialDetail(raw) };
}

async function buildBrief(marketId: string, mode: BriefMode): Promise<BriefResult> {
  const id = encodeURIComponent(marketId);
  const [{ raw: marketRaw, partial }, tradesRaw] = await Promise.all([
    fetchDetail(id),
    pantaGet<MarketTradesResponse>(`/markets/${id}/trades/?limit=${SIGNAL_TAPE_ROWS}`).catch(
      () => null,
    ),
  ]);
  const market = sanitizeMarket(marketRaw);
  if (!market.marketId) throw new UpstreamError(404, "MARKET_NOT_FOUND");
  const rawRows = Array.isArray(tradesRaw?.items) ? tradesRaw.items.slice(0, SIGNAL_TAPE_ROWS) : [];
  const signals = computeMarketSignals(market, rawRows, Date.now(), { partialDetail: partial });
  const tape = sanitizeTape(rawRows);
  const { narrative, source } = await maybeOpenAIBrief(market, signals, mode);
  return {
    market,
    tape,
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
  const rl = rateLimit(`brief:${clientIp(req.headers)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) {
    return fail(429, "RATE_LIMITED", `Max ${RATE_LIMIT} briefs per minute`, {
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
