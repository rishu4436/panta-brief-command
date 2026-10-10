import "server-only";

/**
 * Server-side forecast window check (policy: window.ts).
 *
 * Latency budget (measured 10 Oct 2026: Panta's market-detail endpoint took
 * 3–8 s per call with our key, sometimes hitting the 10 s timeout, and
 * returned partial / priceless records that triggered extra retries; a cold
 * catalog build takes longer than the old 8 s wait):
 *
 *  - AUTHORISING read = the market's on-chain Event account, fetched fresh
 *    for every check (≈20–60 ms, 3 s timeout). Writes (writeWindowSources)
 *    issue their OWN request every time, never joining one that started
 *    before the write arrived; page-view reads may share an in-flight one.
 *    It is never cached.
 *  - Panta detail is shared: one in-flight request per market, successful
 *    full records reused for DETAIL_REUSE_MS. With a fresh chain read the
 *    check waits at most DETAIL_BUDGET_MS for it; detail can only add
 *    restrictions (most advanced phase wins).
 *  - Catalog row: used only if already built (never waits for a cold build).
 *  - If the chain read fails, a FULL detail fetched for this check is
 *    required (bounded by DETAIL_FALLBACK_MS). A thin record (partial or
 *    priceless) is "unavailable" even with a catalog row, because the
 *    catalog is a cache (up to its TTL old) and must never authorise.
 *
 * Reads (page views) may reuse a computed window for READ_CACHE_MS, re-checked
 * against the server clock so a cached "open" never outlives the cutoff;
 * "unavailable" is never cached. Writes always call fetchForecastWindow.
 */

import { peekCatalog } from "@/lib/panta/catalog-server";
import { readEventAccount, readEventAccountFresh, type ChainEventRead } from "@/lib/panta/chain-event-server";
import type { Market } from "@/lib/panta/domain";
import { fetchMarketWithRetry, isPartialMarket, isPricelessDetail } from "@/lib/panta/markets";
import { pantaServerGet, UpstreamError } from "@/lib/panta/server";
import { evaluateForecastWindow, type ForecastWindow } from "./window";

export const DETAIL_TIMEOUT_MS = 6_000;
export const DETAIL_REUSE_MS = 120_000;
export const DETAIL_BUDGET_MS = 750;
export const DETAIL_FALLBACK_MS = 8_000;
const READ_CACHE_MS = 15_000;

type DetailRead = { detail: Market | null; status: "ok" | "not_found" | "failed"; fetchedAt: number };

export type WindowSources = {
  readChain: (marketId: string) => Promise<ChainEventRead>;
  readDetail: (marketId: string) => Promise<DetailRead>;
  /** Detail reused from an earlier successful read (≤ DETAIL_REUSE_MS), if any. */
  recentDetail: (marketId: string, nowMs: number) => DetailRead | null;
  catalogRow: (marketId: string) => Market | null;
  /** Detail fetched for THIS check (chain-failure fallback). Defaults to readDetail. */
  readDetailFresh?: (marketId: string) => Promise<DetailRead>;
};

// ------------------------------------------------------------------ shared detail reads

const detailInflight = new Map<string, Promise<DetailRead>>();
const detailRecent = new Map<string, DetailRead>();

async function fetchDetailOnce(marketId: string): Promise<DetailRead> {
  const fetchedAt = Date.now();
  const path = `/markets/${encodeURIComponent(marketId)}/`;
  try {
    // One short retry for a partial record (not the two-step browser budget).
    const detail = await fetchMarketWithRetry(() => pantaServerGet(path, DETAIL_TIMEOUT_MS), [300]);
    return { detail, status: detail ? "ok" : "failed", fetchedAt };
  } catch (e) {
    return { detail: null, status: e instanceof UpstreamError && e.status === 404 ? "not_found" : "failed", fetchedAt };
  }
}

function readDetailShared(marketId: string): Promise<DetailRead> {
  const hit = detailInflight.get(marketId);
  if (hit) return hit;
  const p = fetchDetailOnce(marketId)
    .then((r) => {
      if (r.status === "ok" && r.detail && !r.detail.partial && !isPartialMarket(r.detail)) {
        detailRecent.set(marketId, r);
        if (detailRecent.size > 500) detailRecent.delete(detailRecent.keys().next().value as string);
      }
      return r;
    })
    .finally(() => detailInflight.delete(marketId));
  detailInflight.set(marketId, p);
  return p;
}

function recentDetail(marketId: string, nowMs: number): DetailRead | null {
  const r = detailRecent.get(marketId);
  return r && nowMs - r.fetchedAt <= DETAIL_REUSE_MS && r.fetchedAt <= nowMs ? r : null;
}

function catalogRow(marketId: string): Market | null {
  try {
    return peekCatalog()?.payload.items.find((m) => m.marketId === marketId) ?? null;
  } catch {
    return null;
  }
}

/** Page views: may share in-flight reads. */
export const liveWindowSources: WindowSources = {
  readChain: (id) => readEventAccount(id),
  readDetail: readDetailShared,
  recentDetail,
  catalogRow,
};

/** Forecast writes: the authorising reads are always issued for this check. */
export const writeWindowSources: WindowSources = {
  ...liveWindowSources,
  readChain: (id) => readEventAccountFresh(id),
  readDetailFresh: async (id) => {
    const r = await fetchDetailOnce(id);
    if (r.status === "ok" && r.detail && !r.detail.partial && !isPartialMarket(r.detail)) detailRecent.set(id, r);
    return r;
  },
};

/** The write-path check (forecast submissions). */
export const checkForecastWindowForWrite = (marketId: string, nowMs: number) => fetchForecastWindow(marketId, nowMs, writeWindowSources);

const withBudget = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** Fresh check (writes). `now` is read again after the awaits so the cutoff test uses the decision time. */
export async function fetchForecastWindow(
  marketId: string,
  nowMs: number,
  src: WindowSources = liveWindowSources,
  now: () => number = Date.now,
): Promise<ForecastWindow> {
  const row = src.catalogRow(marketId);
  const recent = src.recentDetail(marketId, nowMs);
  const detailP = recent ? Promise.resolve(recent) : src.readDetail(marketId);
  const chain = await src.readChain(marketId);
  const decisionNow = Math.max(nowMs, now());
  if (chain.status === "ok" || chain.status === "not_found") {
    const d = recent ?? (await withBudget(detailP, DETAIL_BUDGET_MS));
    return evaluateForecastWindow({
      row,
      detail: d?.detail ?? null,
      detailStatus: d?.status ?? "failed",
      chain: chain.status === "ok" ? { status: "ok", event: chain.event } : { status: "not_found" },
      nowMs: Math.max(decisionNow, now()),
    });
  }
  // Chain unreadable: a detail fetched for THIS check is required (reused records don't authorise).
  const fresh = src.readDetailFresh
    ? await withBudget(src.readDetailFresh(marketId), DETAIL_FALLBACK_MS)
    : recent
      ? await withBudget(src.readDetail(marketId), DETAIL_FALLBACK_MS)
      : await withBudget(detailP, DETAIL_FALLBACK_MS);
  const d = fresh?.detail ?? null;
  // A thin fresh record can't confirm the phase, and the catalog row is a cache: fail closed.
  if (fresh?.status === "ok" && d && (d.partial || isPartialMarket(d) || isPricelessDetail(d))) {
    return evaluateForecastWindow({ row: null, detail: d, detailStatus: "ok", chain: { status: "failed" }, nowMs: Math.max(decisionNow, now()) });
  }
  return evaluateForecastWindow({
    row,
    detail: fresh?.detail ?? null,
    detailStatus: fresh?.status ?? "failed",
    chain: { status: "failed" },
    nowMs: Math.max(decisionNow, now()),
  });
}

// ------------------------------------------------------------------ read cache (page views only)

const readCache = new Map<string, { at: number; window: ForecastWindow }>();
const readInflight = new Map<string, Promise<ForecastWindow>>();

export async function cachedForecastWindow(marketId: string, nowMs: number): Promise<ForecastWindow> {
  const hit = readCache.get(marketId);
  if (hit && nowMs - hit.at < READ_CACHE_MS && hit.at <= nowMs) {
    // Re-apply the cutoff against the current time so a cached "open" can't outlive it.
    if (!(hit.window.open && nowMs >= hit.window.cutoffAt)) return hit.window;
  }
  const pending = readInflight.get(marketId);
  if (pending) return pending;
  const p = fetchForecastWindow(marketId, nowMs)
    .then((window) => {
      // A transient "couldn't confirm" isn't cached: the next read asks again.
      if (!(!window.open && window.reason === "unavailable")) {
        readCache.set(marketId, { at: nowMs, window });
        if (readCache.size > 500) readCache.delete(readCache.keys().next().value as string);
      }
      return window;
    })
    .finally(() => readInflight.delete(marketId));
  readInflight.set(marketId, p);
  return p;
}

/** Tests only. */
export function __resetWindowCachesForTests() {
  detailInflight.clear();
  detailRecent.clear();
  readCache.clear();
  readInflight.clear();
}
