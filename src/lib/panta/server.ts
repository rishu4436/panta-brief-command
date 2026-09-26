import "server-only";

/**
 * Server-only Panta access (route handlers, server components). Holds the
 * only reference to PANTA_API_KEY; `server-only` makes any client import of
 * this module a build error.
 */

import type { Market, Trade } from "./domain";
import { fetchMarketWithRetry, parseMarket, parseTrades } from "./markets";

export const PANTA_UPSTREAM =
  process.env.PANTA_API_BASE_URL?.replace(/\/$/, "") || "https://live-api.panta.market/api/v1";

export function serverApiKey(): string | null {
  return process.env.PANTA_API_KEY?.trim() || null;
}

export class UpstreamError extends Error {
  constructor(
    public status: number,
    public code: string,
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
  return res.json();
}

/** Market detail with the partial-record retry (see markets.ts). */
export async function getMarketServer(marketId: string): Promise<Market | null> {
  const path = `/markets/${encodeURIComponent(marketId)}/`;
  return fetchMarketWithRetry(() => pantaServerGet(path));
}

export async function getMarketTradesServer(marketId: string, limit = 50): Promise<Trade[]> {
  const raw = await pantaServerGet(`/markets/${encodeURIComponent(marketId)}/trades/?limit=${limit}`);
  return parseTrades(raw);
}

/** Soft variant for metadata: null instead of throwing. */
export async function getMarketServerSoft(marketId: string): Promise<Market | null> {
  try {
    return parseMarket(await pantaServerGet(`/markets/${encodeURIComponent(marketId)}/`, 5_000));
  } catch {
    return null;
  }
}
