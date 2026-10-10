import "server-only";

/**
 * Bounded, read-only market snapshot for public views (embeds, share
 * metadata). NEVER used to authorise anything (forecast writes use
 * window-server.ts with fresh reads; scoring uses arena finalization).
 *
 *  - fresh for SNAPSHOT_FRESH_MS (45 s); served stale up to SNAPSHOT_MAX_STALE_MS
 *    (10 min) while one background refresh runs (stale-while-revalidate);
 *    older than that it is dropped;
 *  - a view waits at most SNAPSHOT_WAIT_MS (1.2 s) for a refresh. On a cold
 *    miss the fast chain read (≈20–60 ms) produces a provisional snapshot
 *    (question, phase, primary curve price) while Panta's slower record is
 *    still loading; the full record replaces it when it arrives. With
 *    nothing ready it falls back to the already-built catalog row
 *    (labelled), else "unavailable". Rendering never waits for slow Panta;
 *  - one in-flight refresh per market; bounded map (LRU-ish, 500 entries);
 *  - sources: the on-chain Event account (fast, authoritative for phase and
 *    resolution) + Panta's market record (question, prices; 6 s timeout,
 *    no retries) over the catalog row; merged with the app's existing rules.
 */

import { applyChainEvent, resolveAuthoritativeMarket, withDetail } from "@/lib/panta/catalog";
import { peekCatalog } from "@/lib/panta/catalog-server";
import { readEventAccount, type ChainEventRead } from "@/lib/panta/chain-event-server";
import type { Market } from "@/lib/panta/domain";
import { parseMarket } from "@/lib/panta/markets";
import { pantaServerGet } from "@/lib/panta/server";

export const SNAPSHOT_FRESH_MS = 45_000;
export const SNAPSHOT_MAX_STALE_MS = 10 * 60_000;
export const SNAPSHOT_WAIT_MS = 1_200;
const DETAIL_TIMEOUT_MS = 6_000;
const CHAIN_TIMEOUT_MS = 2_500;
const MAX_ENTRIES = 500;

export type DetailRead = { status: "ok" | "failed"; detail: Market | null };

export type SnapshotEntry = {
  market: Market | null;
  /** Both sources resolved with the same outcome in THIS snapshot. */
  sourcesAgreeResolved: { outcome: "yes" | "no"; slot: number } | null;
  chainOk: boolean;
  detailOk: boolean;
  fetchedAt: number;
  /** Chain-only, written while Panta's record was still loading (refreshed on the next view). */
  provisional?: boolean;
};

export type MarketSnapshot =
  | (SnapshotEntry & { status: "fresh" | "stale"; ageMs: number })
  | { status: "catalog"; market: Market; ageMs: null; sourcesAgreeResolved: null; chainOk: false; detailOk: false; fetchedAt: null }
  | { status: "unavailable"; market: null; ageMs: null; sourcesAgreeResolved: null; chainOk: false; detailOk: false; fetchedAt: null };

export type SnapshotSources = {
  readChain: (marketId: string) => Promise<ChainEventRead>;
  readDetail: (marketId: string) => Promise<DetailRead>;
  catalogRow: (marketId: string) => Market | null;
};

export const liveSnapshotSources: SnapshotSources = {
  readChain: (id) => readEventAccount(id, CHAIN_TIMEOUT_MS),
  readDetail: async (id) => {
    try {
      const d = parseMarket(await pantaServerGet(`/markets/${encodeURIComponent(id)}/`, DETAIL_TIMEOUT_MS));
      return { status: d ? "ok" : "failed", detail: d };
    } catch {
      return { status: "failed", detail: null };
    }
  },
  catalogRow: (id) => {
    try {
      return peekCatalog()?.payload.items.find((m) => m.marketId === id) ?? null;
    } catch {
      return null;
    }
  },
};

const cache = new Map<string, SnapshotEntry>();
type Refresh = { first: Promise<SnapshotEntry | null>; done: Promise<SnapshotEntry | null> };
const inflight = new Map<string, Refresh>();

function compose(chain: ChainEventRead, detail: DetailRead, row: Market | null, fetchedAt: number): SnapshotEntry | null {
  const d = detail.status === "ok" ? detail.detail : null;
  const chainOk = chain.status === "ok";
  if (!chainOk && !d) return null; // nothing fresh: don't overwrite an older snapshot with nothing
  const market = chainOk ? withDetail(applyChainEvent(row ?? undefined, chain.event), d) : resolveAuthoritativeMarket(row, d);
  const chainOutcome = chainOk && chain.event.isResolved && !chain.event.isCancelled ? (chain.event.yesWins ? "yes" : "no") : null;
  const detailOutcome = d && d.resolved === true && (d.outcome === "yes" || d.outcome === "no") ? d.outcome : null;
  return {
    market,
    sourcesAgreeResolved: chainOk && chainOutcome && chainOutcome === detailOutcome ? { outcome: chainOutcome, slot: chain.slot } : null,
    chainOk,
    detailOk: Boolean(d),
    fetchedAt,
  };
}

function store(marketId: string, e: SnapshotEntry) {
  cache.delete(marketId);
  cache.set(marketId, e);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

/** Full snapshot from both sources (exported for tests). */
export async function buildSnapshot(marketId: string, src: SnapshotSources, now: () => number): Promise<SnapshotEntry | null> {
  const [chain, detail] = await Promise.all([src.readChain(marketId), src.readDetail(marketId)]);
  return compose(chain, detail, src.catalogRow(marketId), now());
}

function refresh(marketId: string, src: SnapshotSources, now: () => number): Refresh {
  const hit = inflight.get(marketId);
  if (hit) return hit;
  const chainP = src.readChain(marketId).catch((): ChainEventRead => ({ status: "failed", error: "read failed", fetchedAt: now() }));
  const detailP = src.readDetail(marketId).catch((): DetailRead => ({ status: "failed", detail: null }));
  const done = Promise.all([chainP, detailP])
    .then(([chain, detail]) => {
      const e = compose(chain, detail, src.catalogRow(marketId), now());
      if (e) store(marketId, e);
      return e;
    })
    .catch(() => null)
    .finally(() => inflight.delete(marketId));
  // Provisional chain-only snapshot, only when nothing is cached (never replaces a fuller one).
  const first = Promise.race([
    done,
    chainP.then((chain) => {
      if (chain.status !== "ok") return done;
      const e = compose(chain, { status: "failed", detail: null }, src.catalogRow(marketId), now());
      if (e && !cache.has(marketId)) store(marketId, { ...e, provisional: true });
      return e ? { ...e, provisional: true } : done;
    }),
  ]);
  const r = { first, done };
  inflight.set(marketId, r);
  return r;
}

const withBudget = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

function fromEntry(e: SnapshotEntry, nowMs: number): MarketSnapshot {
  const ageMs = Math.max(0, nowMs - e.fetchedAt);
  return { ...e, status: ageMs <= SNAPSHOT_FRESH_MS ? "fresh" : "stale", ageMs };
}

function fallback(marketId: string, src: SnapshotSources): MarketSnapshot {
  const row = src.catalogRow(marketId);
  return row
    ? { status: "catalog", market: row, ageMs: null, sourcesAgreeResolved: null, chainOk: false, detailOk: false, fetchedAt: null }
    : { status: "unavailable", market: null, ageMs: null, sourcesAgreeResolved: null, chainOk: false, detailOk: false, fetchedAt: null };
}

export async function getMarketSnapshot(
  marketId: string,
  opts: { src?: SnapshotSources; now?: () => number; waitMs?: number } = {},
): Promise<MarketSnapshot> {
  const src = opts.src ?? liveSnapshotSources;
  const now = opts.now ?? Date.now;
  const t = now();
  const cached = cache.get(marketId);
  if (cached && !cached.provisional && t - cached.fetchedAt <= SNAPSHOT_FRESH_MS) return fromEntry(cached, t);
  if (cached && cached.provisional && t - cached.fetchedAt <= SNAPSHOT_MAX_STALE_MS) {
    void refresh(marketId, src, now).done; // full record still loading or failed: try again in the background
    return fromEntry(cached, t);
  }
  if (cached && t - cached.fetchedAt <= SNAPSHOT_MAX_STALE_MS) {
    void refresh(marketId, src, now).done; // stale-while-revalidate
    return fromEntry(cached, t);
  }
  if (cached) cache.delete(marketId);
  const fresh = await withBudget(refresh(marketId, src, now).first, opts.waitMs ?? SNAPSHOT_WAIT_MS);
  return fresh ? fromEntry(fresh, now()) : fallback(marketId, src);
}

/**
 * Build a snapshot from the given sources without reading or writing the
 * shared cache (used by the development-only "market unavailable" preview so
 * a simulated outage can never poison the real cache).
 */
export async function getUncachedMarketSnapshot(
  marketId: string,
  src: SnapshotSources,
  now: () => number = Date.now,
): Promise<MarketSnapshot> {
  const e = await buildSnapshot(marketId, src, now).catch(() => null);
  return e ? fromEntry(e, now()) : fallback(marketId, src);
}

/** Tests only. */
export function __resetSnapshotCacheForTests() {
  cache.clear();
  inflight.clear();
}
