import { NextRequest, NextResponse } from "next/server";
import { maybeOpenAIBrief } from "@/lib/brief";
import { BASE58_PUBKEY_RE } from "@/lib/panta/routes";
import { sanitizeMarket, sanitizeTape } from "@/lib/panta/sanitize";
import { clientIp, rateLimit, TtlCache } from "@/lib/rate-limit";
import type {
  BriefPayload,
  BriefTone,
  MarketCatalogItem,
  MarketTradesResponse,
} from "@/lib/types";

/**
 * POST /api/brief  { marketId, tone }
 *
 * The browser supplies only a market id and a tone. Evidence (market detail +
 * tape) is fetched here from Panta with the server key and sanitized before
 * any AI call, so clients cannot inject their own "market" into a brief.
 */

const UPSTREAM =
  process.env.PANTA_API_BASE_URL?.replace(/\/$/, "") ||
  "https://live-api.panta.market/api/v1";

const MAX_BODY_BYTES = 2 * 1024;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const CACHE_TTL_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 10_000;
const TONES: readonly BriefTone[] = ["bull", "neutral", "bear"];
const ALLOWED_KEYS = new Set(["marketId", "tone"]);

type BriefResult = BriefPayload & { tone: BriefTone };

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

async function buildBrief(marketId: string, tone: BriefTone): Promise<BriefResult> {
  const id = encodeURIComponent(marketId);
  const [marketRaw, tradesRaw] = await Promise.all([
    pantaGet<MarketCatalogItem>(`/markets/${id}/`),
    pantaGet<MarketTradesResponse>(`/markets/${id}/trades/?limit=20`).catch(() => null),
  ]);
  const market = sanitizeMarket(marketRaw);
  if (!market.marketId) throw new UpstreamError(404, "MARKET_NOT_FOUND");
  const tape = sanitizeTape(tradesRaw?.items);
  const { narrative, source } = await maybeOpenAIBrief(market, tape, tone);
  return {
    market,
    tape,
    narrative,
    source,
    tone,
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

  // 3) Strict body: { marketId, tone } only.
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
    return fail(400, "INVALID_REQUEST", "Body must be { marketId, tone }");
  }
  const extra = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
  if (extra.length) {
    return fail(
      400,
      "UNEXPECTED_FIELDS",
      `Only marketId and tone are accepted (got: ${extra.slice(0, 5).join(", ").slice(0, 80)})`,
    );
  }
  const { marketId, tone: toneRaw } = body as { marketId?: unknown; tone?: unknown };
  if (typeof marketId !== "string" || !BASE58_PUBKEY_RE.test(marketId)) {
    return fail(400, "INVALID_MARKET_ID");
  }
  const tone: BriefTone | null =
    toneRaw === undefined
      ? "neutral"
      : typeof toneRaw === "string" && (TONES as readonly string[]).includes(toneRaw)
        ? (toneRaw as BriefTone)
        : null;
  if (!tone) return fail(400, "INVALID_TONE", `tone must be one of ${TONES.join(", ")}`);

  // 4) Cache / in-flight dedupe keyed by marketId+tone (~60s) so repeat clicks
  //    don't re-bill the model.
  try {
    const { value, cached } = await cache.getOrCompute(`${marketId}:${tone}`, () =>
      buildBrief(marketId, tone),
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
