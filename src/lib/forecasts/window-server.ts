import "server-only";

/**
 * Server-side forecast window check (see window.ts for the policy).
 * Writes call `fetchForecastWindow` (fresh Panta detail every time); reads
 * may use `cachedForecastWindow` (15 s per market) so page views don't spend
 * Panta's read budget. A cached "open" never authorises a write.
 */

import { getCatalog } from "@/lib/panta/catalog-server";
import type { Market } from "@/lib/panta/domain";
import { getMarketServer, UpstreamError } from "@/lib/panta/server";
import { evaluateForecastWindow, type ForecastWindow } from "./window";

const CATALOG_WAIT_MS = 8_000;
const READ_CACHE_MS = 15_000;

async function catalogRow(marketId: string): Promise<Market | null> {
  try {
    const res = await Promise.race([
      getCatalog(),
      new Promise<null>((r) => setTimeout(() => r(null), CATALOG_WAIT_MS)),
    ]);
    return res?.payload.items.find((m) => m.marketId === marketId) ?? null;
  } catch {
    return null; // the row can only add restrictions; the fresh detail is still required
  }
}

export async function fetchForecastWindow(marketId: string, nowMs: number): Promise<ForecastWindow> {
  const [row, detailRes] = await Promise.all([
    catalogRow(marketId),
    getMarketServer(marketId).then(
      (detail) => ({ detail, status: detail ? ("ok" as const) : ("failed" as const) }),
      (e: unknown) => ({ detail: null, status: e instanceof UpstreamError && e.status === 404 ? ("not_found" as const) : ("failed" as const) }),
    ),
  ]);
  return evaluateForecastWindow({ row, detail: detailRes.detail, detailStatus: detailRes.status, nowMs });
}

const readCache = new Map<string, { at: number; window: ForecastWindow }>();

export async function cachedForecastWindow(marketId: string, nowMs: number): Promise<ForecastWindow> {
  const hit = readCache.get(marketId);
  if (hit && nowMs - hit.at < READ_CACHE_MS) {
    // Re-apply the cutoff against the current time so a cached "open" can't outlive it.
    if (hit.window.open && nowMs >= hit.window.cutoffAt) return fetchForecastWindow(marketId, nowMs);
    return hit.window;
  }
  const window = await fetchForecastWindow(marketId, nowMs);
  // A transient "couldn't confirm" isn't cached: the next read asks Panta again.
  if (!window.open && window.reason === "unavailable") return window;
  readCache.set(marketId, { at: nowMs, window });
  if (readCache.size > 500) readCache.delete(readCache.keys().next().value as string);
  return window;
}
