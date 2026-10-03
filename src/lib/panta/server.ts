import "server-only";

/**
 * Server-only Panta access (route handlers, server components). Holds the
 * only reference to PANTA_API_KEY; `server-only` makes any client import of
 * this module a build error.
 */

import type { Market } from "./domain";
import { fetchMarketWithRetry, parseMarket, parseTradesStrict, TapeDataError, type TapePage } from "./markets";

export const PANTA_UPSTREAM =
  process.env.PANTA_API_BASE_URL?.replace(/\/$/, "") || "https://live-api.panta.market/api/v1";

export function serverApiKey(): string | null {
  return process.env.PANTA_API_KEY?.trim() || null;
}

export class UpstreamError extends Error {
  constructor(
    public status: number,
    public code: string,
    /** Which upstream call failed and how (safe to show; no secrets). */
    public detail?: string,
  ) {
    super(code);
  }
}

/** GET a Panta path with the server key. Throws UpstreamError on failure. */
export async function pantaServerGet(path: string, timeoutMs = 10_000): Promise<unknown> {
  const key = serverApiKey();
  if (!key) throw new UpstreamError(503, "SERVER_KEY_MISSING");
  let res: Response;
  try {
    res = await fetch(`${PANTA_UPSTREAM}${path}`, {
      headers: { Accept: "application/json", "X-Api-Key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new UpstreamError(502, "PANTA_UNREACHABLE", "unreachable or timed out");
  }
  if (!res.ok) {
    let code = `PANTA_HTTP_${res.status}`;
    try {
      const body = (await res.json()) as { code?: unknown };
      if (typeof body?.code === "string") code = body.code.slice(0, 64);
    } catch {
      /* non-JSON error */
    }
    throw new UpstreamError(res.status === 404 ? 404 : 502, code, `HTTP ${res.status}`);
  }
  return res.json();
}

/** Market detail with the partial-record retry (see markets.ts). */
export async function getMarketServer(marketId: string): Promise<Market | null> {
  const path = `/markets/${encodeURIComponent(marketId)}/`;
  return fetchMarketWithRetry(() => pantaServerGet(path));
}

/**
 * Market tape. Throws on any failure (HTTP error, unreachable, malformed
 * page) — never returns [] for a failed request, so callers can't report a
 * failure as "no recent prints" or cache it as data.
 */
export async function getMarketTradesServer(marketId: string, limit = 50): Promise<TapePage> {
  let raw: unknown;
  try {
    raw = await pantaServerGet(`/markets/${encodeURIComponent(marketId)}/trades/?limit=${limit}`);
  } catch (e) {
    if (e instanceof UpstreamError) {
      // A missing tape for a market is still an upstream failure here, not "no prints".
      throw new UpstreamError(
        e.status === 503 ? 503 : 502,
        e.code,
        `Panta trades request failed: ${e.detail ? `${e.detail} ` : ""}${e.code}`,
      );
    }
    throw e;
  }
  try {
    return parseTradesStrict(raw);
  } catch (e) {
    if (e instanceof TapeDataError) throw new UpstreamError(502, "PANTA_TRADES_MALFORMED", e.message);
    throw e;
  }
}

/** Soft variant for metadata: null instead of throwing. */
export async function getMarketServerSoft(marketId: string): Promise<Market | null> {
  try {
    return parseMarket(await pantaServerGet(`/markets/${encodeURIComponent(marketId)}/`, 5_000));
  } catch {
    return null;
  }
}
